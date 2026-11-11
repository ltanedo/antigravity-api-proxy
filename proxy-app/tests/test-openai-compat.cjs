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
        const openAIResponse = convertAnthropicToOpenAI({
            id: 'msg_gemini_tool_end_turn',
            model: 'gemini-2.5-flash',
            content: [{
                type: 'tool_use',
                id: 'toolu_2',
                name: 'report_translation',
                input: { sum: 18 }
            }],
            stop_reason: 'end_turn',
            usage: {
                input_tokens: 5,
                output_tokens: 3
            }
        });

        assert.equal(openAIResponse.choices[0].message.tool_calls[0].function.name, 'report_translation');
        assert.equal(openAIResponse.choices[0].finish_reason, 'tool_calls');
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

    {
        const state = createOpenAIStreamState({ model: 'gemini-2.5-flash' });

        convertAnthropicStreamEventToOpenAIChunks({
            type: 'content_block_start',
            index: 0,
            content_block: {
                type: 'tool_use',
                id: 'toolu_stream_2',
                name: 'report_translation',
                input: {}
            }
        }, state);

        const endChunks = convertAnthropicStreamEventToOpenAIChunks({
            type: 'message_delta',
            delta: {
                stop_reason: 'end_turn'
            },
            usage: {
                output_tokens: 3
            }
        }, state);

        assert.equal(endChunks[0].choices[0].finish_reason, 'tool_calls');
    }

    {
        const response = convertAnthropicToOpenAI({
            id: 'msg_reasoning', model: 'gemini-3.1-pro-high',
            content: [
                { type: 'thinking', thinking: 'First, ', signature: 'private-signature' },
                { type: 'thinking', thinking: 'check the sum.' },
                { type: 'text', text: 'The answer is 4.' },
                { type: 'tool_use', id: 'toolu_sum', name: 'sum', input: { a: 2, b: 2 } }
            ],
            stop_reason: 'tool_use', usage: { input_tokens: 9, output_tokens: 12 }
        });
        const message = response.choices[0].message;
        assert.equal(message.reasoning_content, 'First, check the sum.');
        assert.equal(message.content, 'The answer is 4.');
        assert.equal(message.tool_calls[0].function.arguments, '{"a":2,"b":2}');
        assert.equal(response.choices[0].finish_reason, 'tool_calls');
        assert.equal(response.usage.total_tokens, 21);
        assert.equal(JSON.stringify(response).includes('private-signature'), false);
        assert.equal(Object.hasOwn(convertAnthropicToOpenAI({ content: [{ type: 'text', text: 'Hi' }] }).choices[0].message, 'reasoning_content'), false);
    }

    {
        const state = createOpenAIStreamState({ model: 'gemini-3.1-pro-high', includeUsage: true });
        const convert = event => convertAnthropicStreamEventToOpenAIChunks(event, state);
        convert({ type: 'message_start', message: { id: 'msg_stream', usage: { input_tokens: 9 } } });
        // Matches src/cloudcode/sse-streamer.js: thinking_delta uses `thinking`.
        const thinking = convert({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Check the sum.' } });
        assert.equal(thinking.length, 1);
        assert.deepEqual(thinking[0].choices[0].delta, { reasoning_content: 'Check the sum.' });
        assert.equal(thinking[0].id, 'chatcmpl_stream');
        assert.deepEqual(convert({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'private' } }), []);
        assert.deepEqual(convert({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '4' } })[0].choices[0].delta, { content: '4' });
        const tool = convert({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_sum', name: 'sum' } });
        assert.equal(tool[0].choices[0].delta.tool_calls[0].index, 0);
        const args = convert({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"a":2}' } });
        assert.equal(args[0].choices[0].delta.tool_calls[0].function.arguments, '{"a":2}');
        const end = convert({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 12 } });
        assert.equal(end[0].choices[0].finish_reason, 'tool_calls');
        assert.deepEqual(end[1].choices, []);
        assert.deepEqual(end[1].usage, { prompt_tokens: 9, completion_tokens: 12, total_tokens: 21 });
    }

    console.log('OpenAI compatibility tests passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
