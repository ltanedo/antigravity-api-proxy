import crypto from 'crypto';

function generateChatCompletionId() {
    return `chatcmpl_${crypto.randomBytes(16).toString('hex')}`;
}

function normalizeCompletionId(id) {
    if (!id) return generateChatCompletionId();
    if (id.startsWith('chatcmpl_')) return id;
    return `chatcmpl_${id.replace(/^[a-z]+_/, '')}`;
}

function parseJson(value, fallback = {}) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }

    if (typeof value !== 'string') {
        return value;
    }

    try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
        return { value: parsed };
    } catch {
        return { __raw_arguments: value };
    }
}

function parseDataUrl(url) {
    if (typeof url !== 'string') return null;
    const match = url.match(/^data:([^;,]+);base64,(.+)$/s);
    if (!match) return null;
    return {
        mediaType: match[1],
        data: match[2]
    };
}

function normalizeStopSequences(stop) {
    if (!stop) return undefined;
    if (Array.isArray(stop)) {
        const values = stop.filter(value => typeof value === 'string' && value.length > 0);
        return values.length > 0 ? values : undefined;
    }
    if (typeof stop === 'string' && stop.length > 0) {
        return [stop];
    }
    return undefined;
}

function extractTextBlocks(content) {
    if (content === undefined || content === null) return [];

    if (typeof content === 'string') {
        return [{ type: 'text', text: content }];
    }

    if (!Array.isArray(content)) {
        return [{ type: 'text', text: String(content) }];
    }

    const blocks = [];
    for (const part of content) {
        if (!part) continue;

        if ((part.type === 'text' || part.type === 'input_text') && typeof part.text === 'string') {
            blocks.push({ type: 'text', text: part.text });
        } else if (part.type === 'refusal' && typeof part.refusal === 'string') {
            blocks.push({ type: 'text', text: part.refusal });
        }
    }

    return blocks;
}

function convertImagePart(part) {
    if (!part || (part.type !== 'image_url' && part.type !== 'input_image')) {
        return null;
    }

    const imageUrl = typeof part.image_url === 'string'
        ? part.image_url
        : (part.image_url?.url || part.url || null);

    if (!imageUrl) return null;

    const dataUrl = parseDataUrl(imageUrl);
    if (dataUrl) {
        return {
            type: 'image',
            source: {
                type: 'base64',
                media_type: dataUrl.mediaType,
                data: dataUrl.data
            }
        };
    }

    return {
        type: 'image',
        source: {
            type: 'url',
            url: imageUrl
        }
    };
}

function convertMessageContent(content, { allowImages = true } = {}) {
    if (content === undefined || content === null) return [];

    if (typeof content === 'string') {
        return [{ type: 'text', text: content }];
    }

    if (!Array.isArray(content)) {
        return [{ type: 'text', text: String(content) }];
    }

    const blocks = [];
    for (const part of content) {
        if (!part) continue;

        if ((part.type === 'text' || part.type === 'input_text') && typeof part.text === 'string') {
            blocks.push({ type: 'text', text: part.text });
            continue;
        }

        if (part.type === 'refusal' && typeof part.refusal === 'string') {
            blocks.push({ type: 'text', text: part.refusal });
            continue;
        }

        if (allowImages) {
            const imageBlock = convertImagePart(part);
            if (imageBlock) {
                blocks.push(imageBlock);
            }
        }
    }

    return blocks;
}

function normalizeToolResultContent(content) {
    if (typeof content === 'string') {
        return content;
    }

    const blocks = convertMessageContent(content, { allowImages: true });
    if (blocks.length === 1 && blocks[0].type === 'text') {
        return blocks[0].text;
    }
    return blocks;
}

function convertOpenAITools(tools) {
    if (!Array.isArray(tools) || tools.length === 0) {
        return undefined;
    }

    const anthropicTools = tools
        .filter(tool => tool?.type === 'function' && tool.function?.name)
        .map(tool => ({
            name: tool.function.name,
            description: tool.function.description || '',
            input_schema: tool.function.parameters || { type: 'object' }
        }));

    return anthropicTools.length > 0 ? anthropicTools : undefined;
}

function convertToolChoice(toolChoice) {
    if (!toolChoice) return undefined;
    if (toolChoice === 'auto') return { type: 'auto' };
    if (toolChoice === 'none') return { type: 'none' };
    if (toolChoice === 'required') return { type: 'any' };
    if (toolChoice?.type === 'function' && toolChoice.function?.name) {
        return {
            type: 'tool',
            name: toolChoice.function.name
        };
    }
    return undefined;
}

function appendToolResult(messages, toolResult) {
    const lastMessage = messages[messages.length - 1];
    if (
        lastMessage &&
        lastMessage.role === 'user' &&
        Array.isArray(lastMessage.content) &&
        lastMessage.content.every(block => block.type === 'tool_result')
    ) {
        lastMessage.content.push(toolResult);
        return;
    }

    messages.push({
        role: 'user',
        content: [toolResult]
    });
}

export function convertOpenAIToAnthropic(chatRequest) {
    const messages = Array.isArray(chatRequest?.messages) ? chatRequest.messages : [];
    const systemBlocks = [];
    const anthropicMessages = [];

    for (const message of messages) {
        if (!message || typeof message !== 'object') continue;

        const role = message.role || 'user';

        if (role === 'system' || role === 'developer') {
            systemBlocks.push(...extractTextBlocks(message.content));
            continue;
        }

        if (role === 'user') {
            anthropicMessages.push({
                role: 'user',
                content: convertMessageContent(message.content, { allowImages: true })
            });
            continue;
        }

        if (role === 'assistant') {
            const content = convertMessageContent(message.content, { allowImages: true });

            if (Array.isArray(message.tool_calls)) {
                for (const toolCall of message.tool_calls) {
                    if (!toolCall?.function?.name) continue;
                    content.push({
                        type: 'tool_use',
                        id: toolCall.id || `toolu_${crypto.randomBytes(12).toString('hex')}`,
                        name: toolCall.function.name,
                        input: parseJson(toolCall.function.arguments, {})
                    });
                }
            }

            anthropicMessages.push({
                role: 'assistant',
                content
            });
            continue;
        }

        if (role === 'tool') {
            appendToolResult(anthropicMessages, {
                type: 'tool_result',
                tool_use_id: message.tool_call_id || message.name || `toolu_${crypto.randomBytes(12).toString('hex')}`,
                content: normalizeToolResultContent(message.content)
            });
            continue;
        }

        if (role === 'function') {
            anthropicMessages.push({
                role: 'user',
                content: [{
                    type: 'text',
                    text: `[Function ${message.name || 'unknown'} result]\n${typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '')}`
                }]
            });
            continue;
        }

        anthropicMessages.push({
            role: 'user',
            content: convertMessageContent(message.content, { allowImages: true })
        });
    }

    return {
        model: chatRequest?.model,
        messages: anthropicMessages,
        stream: !!chatRequest?.stream,
        system: systemBlocks.length > 0 ? systemBlocks : undefined,
        max_tokens: chatRequest?.max_completion_tokens || chatRequest?.max_tokens,
        temperature: chatRequest?.temperature,
        top_p: chatRequest?.top_p,
        stop_sequences: normalizeStopSequences(chatRequest?.stop),
        tools: convertOpenAITools(chatRequest?.tools),
        tool_choice: convertToolChoice(chatRequest?.tool_choice)
    };
}

function mapStopReason(stopReason) {
    if (stopReason === 'max_tokens') return 'length';
    if (stopReason === 'tool_use') return 'tool_calls';
    return 'stop';
}

function extractTextContent(contentBlocks) {
    return contentBlocks
        .filter(block => block?.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('');
}

function extractToolCalls(contentBlocks) {
    const toolCalls = contentBlocks
        .filter(block => block?.type === 'tool_use' && block.name)
        .map(block => ({
            id: block.id,
            type: 'function',
            function: {
                name: block.name,
                arguments: JSON.stringify(block.input || {})
            }
        }));

    return toolCalls.length > 0 ? toolCalls : null;
}

export function convertAnthropicToOpenAI(anthropicResponse) {
    const contentBlocks = Array.isArray(anthropicResponse?.content) ? anthropicResponse.content : [];
    const contentText = extractTextContent(contentBlocks);
    const toolCalls = extractToolCalls(contentBlocks);
    const promptTokens = anthropicResponse?.usage?.input_tokens || 0;
    const completionTokens = anthropicResponse?.usage?.output_tokens || 0;

    return {
        id: normalizeCompletionId(anthropicResponse?.id),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: anthropicResponse?.model,
        choices: [{
            index: 0,
            message: {
                role: 'assistant',
                content: contentText || null,
                tool_calls: toolCalls,
                function_call: null
            },
            finish_reason: mapStopReason(anthropicResponse?.stop_reason),
            logprobs: null
        }],
        usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens
        }
    };
}

function createChunk(state, delta, finishReason = null, choicesOverride = null) {
    return {
        id: state.id,
        object: 'chat.completion.chunk',
        created: state.created,
        model: state.model,
        choices: choicesOverride || [{
            index: 0,
            delta,
            logprobs: null,
            finish_reason: finishReason
        }]
    };
}

export function createOpenAIStreamState({ model, includeUsage = false } = {}) {
    return {
        id: generateChatCompletionId(),
        created: Math.floor(Date.now() / 1000),
        model: model || null,
        includeUsage,
        promptTokens: 0,
        completionTokens: 0,
        toolCallIndexesByBlock: new Map()
    };
}

export function convertAnthropicStreamEventToOpenAIChunks(event, state) {
    if (!event || !state) return [];

    if (event.type === 'message_start') {
        state.id = normalizeCompletionId(event.message?.id);
        state.model = event.message?.model || state.model;
        state.promptTokens = event.message?.usage?.input_tokens || 0;
        return [createChunk(state, { role: 'assistant' })];
    }

    if (event.type === 'content_block_start') {
        if (event.content_block?.type === 'tool_use') {
            const toolCallIndex = state.toolCallIndexesByBlock.size;
            state.toolCallIndexesByBlock.set(event.index, toolCallIndex);

            return [createChunk(state, {
                tool_calls: [{
                    index: toolCallIndex,
                    id: event.content_block.id,
                    type: 'function',
                    function: {
                        name: event.content_block.name,
                        arguments: ''
                    }
                }]
            })];
        }

        return [];
    }

    if (event.type === 'content_block_delta') {
        if (event.delta?.type === 'text_delta') {
            return [createChunk(state, { content: event.delta.text })];
        }

        if (event.delta?.type === 'input_json_delta') {
            const toolCallIndex = state.toolCallIndexesByBlock.get(event.index);
            if (toolCallIndex === undefined) return [];

            return [createChunk(state, {
                tool_calls: [{
                    index: toolCallIndex,
                    function: {
                        arguments: event.delta.partial_json || ''
                    }
                }]
            })];
        }

        return [];
    }

    if (event.type === 'message_delta') {
        state.completionTokens = event.usage?.output_tokens || 0;
        const chunks = [
            createChunk(state, {}, mapStopReason(event.delta?.stop_reason))
        ];

        if (state.includeUsage) {
            chunks.push({
                id: state.id,
                object: 'chat.completion.chunk',
                created: state.created,
                model: state.model,
                choices: [],
                usage: {
                    prompt_tokens: state.promptTokens,
                    completion_tokens: state.completionTokens,
                    total_tokens: state.promptTokens + state.completionTokens
                }
            });
        }

        return chunks;
    }

    return [];
}

export function buildOpenAIErrorPayload(errorType, errorMessage) {
    return {
        error: {
            message: errorMessage,
            type: errorType,
            param: null,
            code: null
        }
    };
}
