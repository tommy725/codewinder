import { Tool, ToolParams } from "langchain/tools";
import { AgentExecutor } from "langchain/agents";
import { Callbacks } from "langchain/callbacks";
import { MemoryStore } from "@/lib/intelligence/memory/MemoryStore";
import { CallbackManagerForToolRun } from "langchain/dist/callbacks/manager";
import { Editor } from "@/lib/intelligence/chains/Editor";
import { CONTEXT_INPUT, OBJECTIVE_INPUT, ReActAgent } from "@/lib/intelligence/react/ReActAgent";
import { Planner } from "@/lib/intelligence/chains/Planner";
import { BaseLanguageModel } from "langchain/base_language";

const DESCRIPTION = `use this tool anytime the objective requires multiple steps or has multiple tasks to accomplish.
The tool input should use this format:
{{
  "action": "tool name",
  "action_input": {{
        "goal": "the goal or objective with specifics from previous actions",
        "tasks": [
            "task 1",
            "task 2"
        ]
    }}
}}`;

interface MultistepToolParams extends ToolParams {
    creative: BaseLanguageModel;
    model: BaseLanguageModel;
    tools: Tool[];
    maxIterations?: number;
    memory: MemoryStore;
}

export class Multistep extends Tool {
    readonly name = "multi-step";
    readonly description = DESCRIPTION;

    readonly creative: BaseLanguageModel;
    readonly maxIterations?: number;
    readonly memory: MemoryStore;
    readonly model: BaseLanguageModel;
    readonly returnDirect = true;
    readonly tools: Tool[];

    constructor({ model, creative, memory, tools, maxIterations, verbose, callbacks }: MultistepToolParams) {
        super(verbose, callbacks);

        this.creative = creative;
        this.maxIterations = maxIterations;
        this.memory = memory;
        this.model = model;
        this.tools = tools;
    }

    async _call(input: string, callbackManager?: CallbackManagerForToolRun): Promise<string> {
        return await Multistep.runAgent(this.model, this.creative, this.memory, this.tools, this.callbacks, this.verbose, this.maxIterations || 8, JSON.parse(input), callbackManager);
    }

    static async runAgent(
        model: BaseLanguageModel, creative: BaseLanguageModel, memory: MemoryStore, tools: Tool[], callbacks: Callbacks, verbose: boolean, maxIterations: number, plan: {
            goal: string;
            tasks: string[];
        }, callbackManager?: CallbackManagerForToolRun): Promise<string>
    {
        const agent = ReActAgent.makeAgent({model, creative, memory, tools, callbacks});
        const executor = AgentExecutor.fromAgentAndTools({
            agent,
            tools,
            verbose,
            callbacks,
            maxIterations
        });

        const planner = Planner.makeChain({model: creative, callbacks});
        const interim = await planner.evaluate({
            goal: plan.goal,
            tasks: JSON.stringify(plan.tasks)
        });
        const newPlan = JSON.parse(interim);

        let results = [];
        for (const task of newPlan.tasks) {
            await callbackManager?.handleText("Starting: " + task);

            let inputs = {};
            inputs[CONTEXT_INPUT] = results.length > 0 ? results[results.length - 1] : "";
            inputs[OBJECTIVE_INPUT] = `${task} - supporting this overall goal: ${newPlan.goal}`

            const completion = await executor.call(inputs);
            results.push(completion.output);
        }

        const editor = Editor.makeChain({model: creative, callbacks});
        return await editor.evaluate({
            context: results.join("\n\n"),
            goal: plan.goal
        });
    }
}
