const assert = require('assert/strict');

(async () => {
    const {
        convertOpenAIToAnthropic,
        convertAnthropicToOpenAI,
        createOpenAIStreamState,
        convertAnthropicStreamEventToOpenAIChunks
    } = await import('../src/compat/openai.js');

    {
        const anthropicRequest = convertOpenAIToAnthropic({
            model: 'claude-sonnet-4-6-thinking',
            messages: [
                { role: 'system', content: 'You are terse.' },
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Look at this image' },
                        { type: 'image_url', image_url: { url: 'data:image/png;base64,Zm9v' } }
                    ]
                },
                {
                    role: 'assistant',
                    content: 'Calling the weather tool',
                    tool_calls: [{
                        id: 'call_weather_1',
                        type: 'function',
                        function: {
                            name: 'get_weather',
                            arguments: '{"city":"New York"}'
                        }
                    }]
                },
                {
                    role: 'tool',
                    tool_call_id: 'call_weather_1',
                    content: '72F and sunny'
                }
            ],
            tools: [{
                type: 'function',
                function: {
                    name: 'get_weather',
                    description: 'Get weather',
                    parameters: {
                        type: 'object',
                        properties: {
                            city: { type: 'string' }
                        }
                    }
                }
            }],
            tool_choice: 'required',
            stop: ['END'],
            max_completion_tokens: 256,
            temperature: 0.2
        });

        assert.equal(anthropicRequest.model, 'claude-sonnet-4-6-thinking');
        assert.deepEqual(anthropicRequest.system, [{ type: 'text', text: 'You are terse.' }]);
        assert.equal(anthropicRequest.max_tokens, 256);
        assert.equal(anthropicRequest.temperature, 0.2);
        assert.deepEqual(anthropicRequest.stop_sequences, ['END']);
        assert.equal(anthropicRequest.tool_choice.type, 'any');
        assert.equal(anthropicRequest.tools[0].name, 'get_weather');
        assert.equal(anthropicRequest.messages[0].role, 'user');
        assert.equal(anthropicRequest.messages[0].content[1].source.type, 'base64');
        assert.equal(anthropicRequest.messages[1].role, 'assistant');
        assert.equal(anthropicRequest.messages[1].content[1].type, 'tool_use');
        assert.equal(anthropicRequest.messages[2].role, 'user');
        assert.equal(anthropicRequest.messages[2].content[0].type, 'tool_result');
    }

    {
        const openAIResponse = convertAnthropicToOpenAI({
            id: 'msg_abc123',
            model: 'gemini-3.1-pro-high[1m]',
            content: [
                { type: 'thinking', thinking: 'hidden' },
                { type: 'text', text: 'Tool call incoming.' },
                {
                    type: 'tool_use',
                    id: 'toolu_1',
                    name: 'get_weather',
                    input: { city: 'New York' }
                }
            ],
            stop_reason: 'tool_use',
            usage: {
                input_tokens: 11,
                output_tokens: 7
            }
        });

        assert.equal(openAIResponse.object, 'chat.completion');
        assert.ok(openAIResponse.id.startsWith('chatcmpl_'));
        assert.equal(openAIResponse.choices[0].message.role, 'assistant');
        assert.equal(openAIResponse.choices[0].message.content, 'Tool call incoming.');
        assert.equal(openAIResponse.choices[0].message.tool_calls[0].function.name, 'get_weather');
        assert.equal(openAIResponse.choices[0].finish_reason, 'tool_calls');
        assert.equal(openAIResponse.usage.total_tokens, 18);
    }

    {
        const state = createOpenAIStreamState({ model: 'claude-sonnet-4-6-thinking', includeUsage: true });

        const startChunks = convertAnthropicStreamEventToOpenAIChunks({
            type: 'message_start',
            message: {
                id: 'msg_stream1',
                model: 'claude-sonnet-4-6-thinking',
                usage: { input_tokens: 13 }
            }
        }, state);
        assert.equal(startChunks[0].choices[0].delta.role, 'assistant');

        const textChunks = convertAnthropicStreamEventToOpenAIChunks({
            type: 'content_block_delta',
            index: 0,
            delta: {
                type: 'text_delta',
                text: 'Hello'
            }
        }, state);
        assert.equal(textChunks[0].choices[0].delta.content, 'Hello');

        const toolStartChunks = convertAnthropicStreamEventToOpenAIChunks({
            type: 'content_block_start',
            index: 2,
            content_block: {
                type: 'tool_use',
                id: 'toolu_stream_1',
                name: 'get_weather',
                input: {}
            }
        }, state);
        assert.equal(toolStartChunks[0].choices[0].delta.tool_calls[0].function.name, 'get_weather');

        const toolArgChunks = convertAnthropicStreamEventToOpenAIChunks({
            type: 'content_block_delta',
            index: 2,
            delta: {
                type: 'input_json_delta',
                partial_json: '{"city":"Boston"}'
            }
        }, state);
        assert.equal(toolArgChunks[0].choices[0].delta.tool_calls[0].function.arguments, '{"city":"Boston"}');

        const endChunks = convertAnthropicStreamEventToOpenAIChunks({
            type: 'message_delta',
            delta: {
                stop_reason: 'tool_use'
            },
            usage: {
                output_tokens: 5
            }
        }, state);

        assert.equal(endChunks[0].choices[0].finish_reason, 'tool_calls');
        assert.deepEqual(endChunks[1].usage, {
            prompt_tokens: 13,
            completion_tokens: 5,
            total_tokens: 18
        });
    }

    console.log('OpenAI compatibility tests passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
