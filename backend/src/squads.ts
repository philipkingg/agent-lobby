import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Agent } from "./agents.js";

export interface Squad {
  id: string;
  name: string;
  projectIds: string; // JSON array
}

export interface SquadWithMembers extends Squad {
  agents: Agent[];
}

export interface CreateSquadInput {
  name: string;
  projectIds?: string[];
  agentIds?: string[];
}

export function createSquad(db: DatabaseSync, input: CreateSquadInput): Squad {
  const id = randomUUID();
  const squad: Squad = {
    id,
    name: input.name,
    projectIds: JSON.stringify(input.projectIds ?? []),
  };

  db.prepare(`INSERT INTO squads (id, name, projectIds) VALUES (?, ?, ?)`).run(
    squad.id,
    squad.name,
    squad.projectIds
  );

  if (input.agentIds?.length) {
    for (const agentId of input.agentIds) {
      addAgentToSquad(db, id, agentId);
    }
  }

  return squad;
}

export function updateSquad(
  db: DatabaseSync,
  id: string,
  updates: { name?: string; projectIds?: string[] }
): Squad | undefined {
  const squad = getSquad(db, id);
  if (!squad) return undefined;

  if (updates.name !== undefined) {
    db.prepare(`UPDATE squads SET name = ? WHERE id = ?`).run(updates.name, id);
  }
  if (updates.projectIds !== undefined) {
    db.prepare(`UPDATE squads SET projectIds = ? WHERE id = ?`).run(
      JSON.stringify(updates.projectIds),
      id
    );
  }

  return getSquad(db, id);
}

export function deleteSquad(db: DatabaseSync, id: string): boolean {
  const squad = getSquad(db, id);
  if (!squad) return false;

  // Unassign all agents from this squad
  db.prepare(`UPDATE agents SET squadId = NULL WHERE squadId = ?`).run(id);
  db.prepare(`DELETE FROM squad_agents WHERE squadId = ?`).run(id);
  db.prepare(`DELETE FROM squads WHERE id = ?`).run(id);
  return true;
}

export function listSquads(db: DatabaseSync): Squad[] {
  return db.prepare(`SELECT * FROM squads ORDER BY name ASC`).all() as Squad[];
}

export function getSquad(db: DatabaseSync, id: string): Squad | undefined {
  return db.prepare(`SELECT * FROM squads WHERE id = ?`).get(id) as Squad | undefined;
}

export function addAgentToSquad(db: DatabaseSync, squadId: string, agentId: string): void {
  // Remove from any existing squad first
  removeAgentFromSquads(db, agentId);

  db.prepare(
    `INSERT OR IGNORE INTO squad_agents (squadId, agentId) VALUES (?, ?)`
  ).run(squadId, agentId);
  db.prepare(`UPDATE agents SET squadId = ? WHERE id = ?`).run(squadId, agentId);
}

export function removeAgentFromSquad(db: DatabaseSync, squadId: string, agentId: string): void {
  db.prepare(`DELETE FROM squad_agents WHERE squadId = ? AND agentId = ?`).run(squadId, agentId);
  db.prepare(`UPDATE agents SET squadId = NULL WHERE id = ? AND squadId = ?`).run(agentId, squadId);
}

export function removeAgentFromSquads(db: DatabaseSync, agentId: string): void {
  db.prepare(`DELETE FROM squad_agents WHERE agentId = ?`).run(agentId);
  db.prepare(`UPDATE agents SET squadId = NULL WHERE id = ?`).run(agentId);
}

export function getSquadProjectIds(db: DatabaseSync, squadId: string): string[] {
  const squad = getSquad(db, squadId);
  if (!squad) return [];
  return JSON.parse(squad.projectIds) as string[];
}

export function agentCanWorkOnProject(
  db: DatabaseSync,
  agentId: string,
  projectId: string
): boolean {
  const row = db.prepare(`SELECT squadId FROM agents WHERE id = ?`).get(agentId) as
    | { squadId: string | null }
    | undefined;
  if (!row) return false;
  if (!row.squadId) return true; // no squad = works on any project

  const projectIds = getSquadProjectIds(db, row.squadId);
  return projectIds.length === 0 || projectIds.includes(projectId);
}
