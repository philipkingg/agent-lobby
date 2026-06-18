import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Task, TaskStage } from "./tasks.js";
import type { Project } from "./projects.js";
import type { Agent } from "./agents.js";
import { parsePersonality, buildPersonalityPrompt } from "./agents.js";

const AGENTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "agents");

function readKnowledgeFile(jobType: string): string {
  try {
    return readFileSync(path.join(AGENTS_DIR, `${jobType}.md`), "utf-8").trim();
  } catch {
    return "";
  }
}

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
You are a software planner. Analyze this task:
Title: ${task.title}
Description: ${task.description}
Repository: ${project.path}

Read relevant parts of the codebase.

If this task is COMPLEX (multiple independent features, distinct subsystems, or large enough that splitting into parallel streams is clearly better), split it into 2-5 subtasks. Output ONLY the following line and nothing else:
SPLIT_EPIC: [{"title":"Subtask title","description":"Full implementation spec for this subtask"},...]

If the task is SIMPLE or FOCUSED enough to implement in one pass, write a numbered implementation plan:
- Files to create or modify
- What changes to make in each file
- Testing approach

End a non-split plan with: PLAN_COMPLETE
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

IMPORTANT: Bias strongly toward APPROVE. Only output REQUEST_CHANGES if:
- Core task requirements are clearly not met (feature missing or fundamentally broken)
- There is a correctness bug causing wrong behavior or runtime errors
- There is a security vulnerability

Do NOT block on: code style, naming preferences, minor improvements, missing comments, or non-critical refactors. Mention these as suggestions in your APPROVE message instead.

If implementation is acceptable (even if imperfect): output "APPROVE" and briefly explain. Include minor suggestions in the approval.
If there is a blocking issue per the criteria above: output "REQUEST_CHANGES: [clear summary of what must be fixed]" and list only the specific blocking issues.
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

export function buildStagePrompt(task: Task, project: Project, agent: Agent, reviewFeedback?: string): string {
  const baseBuilder = STAGE_BASE_PROMPTS[task.stage];
  const base = baseBuilder ? baseBuilder(task, project) : `Complete task: ${task.title}\n${task.description}`;

  const personality = parsePersonality(agent);
  const personalityText = buildPersonalityPrompt(personality);

  const knowledge = readKnowledgeFile(agent.jobType);
  const knowledgeSection = knowledge ? `${knowledge}\n\n---\n\n` : "";

  const feedbackSection = reviewFeedback
    ? `\n\nPREVIOUS REVIEW FEEDBACK — you MUST address these specific issues before finishing:\n\n${reviewFeedback}`
    : "";

  return knowledgeSection + base + feedbackSection + personalityText;
}

// Detect a review rejection in the result text
export function detectReviewOutcome(resultText: string): "approve" | "request_changes" | "unknown" {
  if (/REQUEST_CHANGES/i.test(resultText)) return "request_changes";
  if (/\bAPPROVE\b/i.test(resultText)) return "approve";
  return "unknown";
}
