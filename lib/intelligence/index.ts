import { Tool } from "langchain/tools";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { ReActAgent } from "@/lib/intelligence/react/ReActAgent";
import { JavascriptEvaluator } from "@/lib/intelligence/tools/JavascriptEvaluator";
import { BingSearch } from "@/lib/intelligence/tools/BingSearch";
import { Callbacks } from "langchain/callbacks";
import { WebBrowser } from "@/lib/intelligence/tools/WebBrowser";
import { MemoryStore } from "@/lib/intelligence/memory/MemoryStore";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { BingNews } from "@/lib/intelligence/tools/BingNews";
import { Multistep } from "@/lib/intelligence/tools/Multistep";
import { MemoryRecall } from "@/lib/intelligence/tools/MemoryRecall";
import { MemoryStorage } from "@/lib/intelligence/tools/MemoryStorage";
import { AgentExecutor } from "langchain/agents";

const MAX_ITERATIONS = 10;

export const makeChain = async ({ callbacks }: { callbacks: Callbacks }): Promise<AgentExecutor> => {
    const openAIApiKey = process.env.OPENAI_API_KEY;
    if (!Boolean(openAIApiKey)) {
        throw new Error('OpenAI api key not found.');
    }
    const bingApiKey = process.env.BING_API_KEY;

    // This is GPT3.5 with temp of 0
    const predictable = new ChatOpenAI({
        openAIApiKey,
        temperature: 0,
        streaming: Boolean(callbacks),
        callbacks,
        maxRetries: 2
    });
    // This is GPT4 with temp of 0
    // const capable = new ChatOpenAI({
    //     openAIApiKey,
    //     temperature: 0,
    //     modelName: 'gpt-4',
    //     streaming: Boolean(callbacks),
    //     callbacks,
    //     maxRetries: 2
    // });
    // This is GPT4 with temp of the default
    const creative = new ChatOpenAI({
        openAIApiKey,
        modelName: 'gpt-4',
        streaming: Boolean(callbacks),
        callbacks,
        maxRetries: 2
    });

    const embeddings = new OpenAIEmbeddings({ openAIApiKey });
    const memory = process.env.SUPABASE_URL ?
        await MemoryStore.makeLongTermStore(embeddings) :
        await MemoryStore.makeShortTermStore(embeddings);

    const tools: Tool[] = [
        // new LocalBrowser({ model: capable }),
        new WebBrowser({ model: predictable, memory, embeddings, callbacks }),
        new JavascriptEvaluator(),
        new MemoryRecall({ model: predictable, memory }),
        new MemoryStorage({ model: predictable, memory, embeddings })
    ];
    if (Boolean(bingApiKey)) {
        tools.push(new BingNews({ apiKey: bingApiKey, embeddings, callbacks }));
        tools.push(new BingSearch({ apiKey: bingApiKey, embeddings, callbacks }));
    }
    const multistep = new Multistep({
        callbacks,
        creative,
        maxIterations: MAX_ITERATIONS,
        model: predictable,
        memory,
        tools
    });
    const toolset = [ ...tools, multistep ];

    const agent = ReActAgent.makeAgent({
        callbacks,
        creative,
        maxIterations: MAX_ITERATIONS,
        memory,
        model: predictable,
        tools: toolset
    });

    return AgentExecutor.fromAgentAndTools({
        agent,
        callbacks,
        maxIterations: MAX_ITERATIONS,
        tools: toolset,
        verbose: true
    });
}