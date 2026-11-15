/**
 * Household roles (§12.5, §23.1): the player assigns kin and lieutenants as lieutenant, governor
 * of a holding, captain of a fleet, steward, envoy or seer, or relieves them of office ('npc');
 * the command schema accepts only these (schemas.ts ASSIGNABLE_ROLES). The ruler and the regent
 * come only from succession.
 */
import { CommandError } from '@sim/core/commands';
import type { CommandHandler } from '@sim/core/module';
import type { CharacterRole, CharId, RoleKind } from '@sim/core/state';
import { ASSIGNABLE_ROLES } from './schemas';
import { charOf, isAdultAt, notifyHouse, peopleState } from './util';

/** `assignRole`: give a member of the player's house a role. */
export const handleAssignRole: CommandHandler<'assignRole'> = (draft, cmd, ctx) => {
  const c = charOf(draft, cmd.charId);
  if (!c) throw new CommandError('unknownCharacter', `No character ${cmd.charId}`);
  if (!c.alive) throw new CommandError('dead', `${c.name} is dead`);
  const fid = draft.player.factionId;
  if (c.factionId !== fid) throw new CommandError('notYours', `${c.name} does not serve your house`);
  if (c.id === draft.player.rulerId) throw new CommandError('isRuler', 'The ruler holds no lesser office');
  if (peopleState(draft).regency?.regentId === c.id) throw new CommandError('isRegent', 'The regent serves until the heir comes of age');
  if (c.location.kind === 'captive') throw new CommandError('captive', `${c.name} is held captive`);
  if (!isAdultAt(c, ctx.hour, ctx.content)) throw new CommandError('minor', `${c.name} is too young`);
  const kind: RoleKind = cmd.role;
  if (!ASSIGNABLE_ROLES.includes(cmd.role)) throw new CommandError('invalidRole', 'That role cannot be assigned');
  const previous = c.role;
  const role: CharacterRole = { kind, factionId: fid };
  if (kind === 'governor') {
    const sid = cmd.holdingId;
    const s = sid !== undefined && Object.hasOwn(draft.settlements, sid) ? draft.settlements[sid] : undefined;
    if (!s || s.factionId !== fid || !s.holding) throw new CommandError('notAHolding', 'Choose one of your holdings');
    const former = charOf(draft, s.holding.governorId);
    if (former && former.id !== c.id && former.id !== draft.player.rulerId && former.role?.kind === 'governor' && former.role.holdingId === s.id) {
      former.role = { kind: 'lieutenant', factionId: fid };
    }
    s.holding.governorId = c.id;
    role.holdingId = s.id;
  } else if (kind === 'captain') {
    const fleet = cmd.fleetId !== undefined && Object.hasOwn(draft.fleets, cmd.fleetId) ? draft.fleets[cmd.fleetId] : undefined;
    if (!fleet || fleet.ownerId !== fid) throw new CommandError('notAFleet', 'Choose one of your fleets');
    role.fleetId = fleet.id;
  } else if (kind === 'steward') {
    for (const id of Object.keys(draft.characters) as CharId[]) {
      const other = draft.characters[id];
      if (other && other.id !== c.id && other.alive && other.factionId === fid && other.role?.kind === 'steward') {
        other.role = { kind: 'lieutenant', factionId: fid };
      }
    }
  }
  // Leaving a governorship hands the holding back to the ruler.
  if (previous?.kind === 'governor' && previous.holdingId !== undefined && previous.holdingId !== role.holdingId) {
    const old = draft.settlements[previous.holdingId];
    if (old?.holding && old.holding.governorId === c.id) old.holding.governorId = draft.player.rulerId;
  }
  c.role = role;
  const e: { type: 'RoleAssigned'; charId: CharId; role: RoleKind; previousRole?: RoleKind; holdingId?: CharacterRole['holdingId']; fleetId?: CharacterRole['fleetId'] } = {
    type: 'RoleAssigned',
    charId: c.id,
    role: kind,
  };
  if (previous) e.previousRole = previous.kind;
  if (role.holdingId !== undefined) e.holdingId = role.holdingId;
  if (role.fleetId !== undefined) e.fleetId = role.fleetId;
  ctx.emit(e);
  notifyHouse(ctx, c, 'people.notify.roleAssigned', { role: kind });
};
