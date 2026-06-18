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

As you work, commit changes with descriptive messages. When implementation is complete:
1. git fetch origin ${project.defaultBranch} && git merge origin/${project.defaultBranch}
2. Resolve any merge conflicts and commit them
3. git push -u origin ${task.branch ?? "HEAD"}
4. Create the PR (safe to run even if it already exists):
   gh pr create --base ${project.defaultBranch} --title "<task title>" --body "<task description>" 2>/dev/null || true
5. Get the PR URL: gh pr view --json url --jq .url
6. Output on its own line: PR_URL: <that url>
`.trim(),

  "queued:review": (task, project) => `
You are a code reviewer for: ${task.title}
Description: ${task.description}
${task.prUrl ? `PR: ${task.prUrl}` : `Branch: ${task.branch ?? "HEAD"}, Base: ${project.defaultBranch}`}
Working directory: ${task.worktreePath ?? project.path}

Review the implementation:
- View the diff: gh pr diff
- View existing comments: gh pr view --comments
- Read changed files for deeper context if needed

IMPORTANT: Bias strongly toward APPROVE. Only block on:
- Core requirements clearly not met (feature missing or fundamentally broken)
- A correctness bug causing wrong behavior or runtime errors
- A security vulnerability

Do NOT block on: style, naming, minor improvements, missing comments, non-critical refactors.

When you have formed your verdict:
- If approved: run \`gh pr review --approve --body "APPROVE: <brief explanation>"\`
  Then write on its own line: APPROVE

- If changes needed: run \`gh pr review --request-changes --body "REQUEST_CHANGES: <specific blocking issues>"\`
  Then write on its own line: REQUEST_CHANGES: <same summary>
`.trim(),

  "queued:merge": (task, project) => {
    const prSection = task.prUrl
      ? `PR: ${task.prUrl}\n\nThe PR already exists and is approved. Merge it:\ngh pr merge --squash`
      : `Branch: ${task.branch ?? "HEAD"}\n\nThe PR was not created yet. Push and create it:\n1. git push -u origin ${task.branch ?? "HEAD"}\n2. gh pr create --base ${project.defaultBranch} --title "<task title>" --body "<description>"\n3. gh pr merge --squash`;
    return `
You are a merger agent. The implementation has been reviewed and approved:
Title: ${task.title}
${prSection}
Working directory: ${task.worktreePath ?? project.path}

Output "MERGED" when complete.
`.trim();
  },
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
