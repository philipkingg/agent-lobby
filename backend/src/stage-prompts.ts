import type { Task, TaskStage } from "./tasks.js";
import type { Project } from "./projects.js";
import type { Agent } from "./agents.js";
import { parsePersonality, buildPersonalityPrompt } from "./agents.js";

type PromptBuilder = (task: Task, project: Project) => string;

const STAGE_BASE_PROMPTS: Partial<Record<TaskStage, PromptBuilder>> = {
  "queued:prioritize": (task) => `
You are a task prioritizer. Review this task:
Title: ${task.title}
Description: ${task.description}
Current priority: ${task.priority} (1=lowest, 5=highest)

Assess the task's urgency and complexity. Output exactly this line first:
PRIORITY: N
(where N is 1-5, then 1-2 sentences explaining why.)
`.trim(),

  "queued:plan": (task, project) => `
You are a software planner. Create a clear implementation plan for:
Title: ${task.title}
Description: ${task.description}
Repository: ${project.path}

Read relevant parts of the codebase. Write a numbered implementation plan including:
- Files to create or modify
- What changes to make in each file
- Testing approach

End your plan with: PLAN_COMPLETE
`.trim(),

  "queued:implement": (task, project) => `
${task.description}

You are implementing: ${task.title}
Working directory: ${task.worktreePath ?? project.path}
${task.branch ? `Branch: ${task.branch}` : ""}

As you work, commit changes with clear messages. When done:
1. Run: git fetch origin ${project.defaultBranch}
2. Run: git merge origin/${project.defaultBranch}
3. Resolve any conflicts and commit
The branch must be conflict-free before you finish.
`.trim(),

  "queued:review": (task, project) => `
You are a code reviewer. Review the implementation for:
Title: ${task.title}
Description: ${task.description}
${task.branch ? `Branch: ${task.branch}` : ""}
Base: ${project.defaultBranch}

Run: git diff origin/${project.defaultBranch}...HEAD
Working directory: ${task.worktreePath ?? project.path}

If the implementation is acceptable: output "APPROVE" and briefly explain.
If changes are needed: output "REQUEST_CHANGES: [summary]" and list specific issues.
`.trim(),

  "queued:merge": (task, project) => `
You are a merger agent. This task has been reviewed and approved:
Title: ${task.title}
${task.branch ? `Branch: ${task.branch}` : ""}

Steps:
1. git push -u origin ${task.branch ?? "HEAD"}
2. gh pr create --base ${project.defaultBranch} --title "${task.title}" --body "${task.description}"
3. gh pr merge --auto --squash

Output "MERGED" when the PR is created and auto-merge is enabled.
`.trim(),
};

export function buildStagePrompt(task: Task, project: Project, agent: Agent): string {
  const baseBuilder = STAGE_BASE_PROMPTS[task.stage];
  const base = baseBuilder ? baseBuilder(task, project) : `Complete task: ${task.title}\n${task.description}`;

  const personality = parsePersonality(agent);
  const personalityText = buildPersonalityPrompt(personality);

  return base + personalityText;
}

// Detect a review rejection in the result text
export function detectReviewOutcome(resultText: string): "approve" | "request_changes" | "unknown" {
  if (/REQUEST_CHANGES/i.test(resultText)) return "request_changes";
  if (/\bAPPROVE\b/i.test(resultText)) return "approve";
  return "unknown";
}
