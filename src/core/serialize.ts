import LZString from 'lz-string';
import { getDef } from './nodes/registry';
import { ELEMENTS, SPELL_FORMAT, V, uid, type DataType, type Literal, type SpellDoc, type SpellGraph, type VarDecl } from './types';

export class ImportError extends Error {}

const DATA_TYPES: DataType[] = ['number', 'bool', 'vector', 'entity', 'entities', 'element', 'any'];

function isLiteral(v: unknown): v is Literal {
  return typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string' || V.isVec(v);
}

function checkGraph(g: unknown, where: string, warnings: string[]): SpellGraph {
  if (!g || typeof g !== 'object') throw new ImportError(`${where} is missing or not an object.`);
  const o = g as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) throw new ImportError(`${where} has no id.`);
  if (!Array.isArray(o.nodes)) throw new ImportError(`${where}.nodes must be an array.`);
  if (!Array.isArray(o.edges)) throw new ImportError(`${where}.edges must be an array.`);
  const ids = new Set<string>();
  const nodes = o.nodes.map((n: unknown, i: number) => {
    const nn = n as Record<string, unknown>;
    if (!nn || typeof nn !== 'object') throw new ImportError(`${where}.nodes[${i}] is not an object.`);
    if (typeof nn.id !== 'string' || !nn.id) throw new ImportError(`${where}.nodes[${i}] has no id.`);
    if (ids.has(nn.id)) throw new ImportError(`${where} has two nodes with id “${nn.id}”.`);
    ids.add(nn.id);
    if (typeof nn.type !== 'string') throw new ImportError(`${where}.nodes[${i}] has no type.`);
    if (!getDef(nn.type)) warnings.push(`Unknown node type “${nn.type}” in ${where} — it will show as an error.`);
    const values: Record<string, Literal> = {};
    if (nn.values && typeof nn.values === 'object') {
      for (const [k, v] of Object.entries(nn.values as Record<string, unknown>)) {
        if (isLiteral(v)) values[k] = v;
        else warnings.push(`Dropped invalid value “${k}” on node ${nn.id}.`);
      }
    }
    return {
      id: nn.id,
      type: nn.type,
      x: typeof nn.x === 'number' && Number.isFinite(nn.x) ? nn.x : i * 40,
      y: typeof nn.y === 'number' && Number.isFinite(nn.y) ? nn.y : i * 40,
      values,
      note: typeof nn.note === 'string' ? nn.note.slice(0, 500) : undefined,
    };
  });
  const edges = o.edges
    .map((e: unknown, i: number) => {
      const ee = e as Record<string, unknown>;
      if (!ee || typeof ee.from !== 'string' || typeof ee.to !== 'string' || typeof ee.fromPort !== 'string' || typeof ee.toPort !== 'string') {
        warnings.push(`Dropped malformed connection #${i} in ${where}.`);
        return null;
      }
      if (!ids.has(ee.from) || !ids.has(ee.to)) {
        warnings.push(`Dropped connection #${i} in ${where}: it points at a missing node.`);
        return null;
      }
      return { id: typeof ee.id === 'string' ? ee.id : uid('e'), from: ee.from, to: ee.to, fromPort: ee.fromPort, toPort: ee.toPort };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);
  const params = Array.isArray(o.params)
    ? o.params
        .filter((p: unknown) => {
          const pp = p as Record<string, unknown>;
          return pp && typeof pp.id === 'string' && typeof pp.name === 'string' && DATA_TYPES.includes(pp.type as DataType);
        })
        .map((p: unknown) => p as { id: string; name: string; type: DataType })
    : undefined;
  return { id: o.id, name: typeof o.name === 'string' ? o.name : o.id, nodes, edges, params };
}

/**
 * Validate an untrusted JSON object as a spell document. Throws ImportError
 * with a human message on structural problems; collects soft warnings.
 */
export function validateSpellDoc(raw: unknown): { doc: SpellDoc; warnings: string[] } {
  const warnings: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ImportError('Not a spell: expected a JSON object.');
  const o = raw as Record<string, unknown>;
  if (o.format !== SPELL_FORMAT) {
    if (typeof o.format === 'string' && o.format.startsWith('spell-compiler/')) warnings.push(`Format ${o.format} differs from ${SPELL_FORMAT}; importing anyway.`);
    else throw new ImportError(`Not a Spell Compiler spell (missing "format": "${SPELL_FORMAT}").`);
  }
  if (typeof o.name !== 'string' || !o.name.trim()) throw new ImportError('The spell has no name.');
  const main = checkGraph(o.main, 'main', warnings);
  const subspells = Array.isArray(o.subspells) ? o.subspells.map((s, i) => checkGraph(s, `subspells[${i}]`, warnings)) : [];
  const variables: VarDecl[] = Array.isArray(o.variables)
    ? (o.variables as unknown[])
        .filter((v): v is VarDecl => {
          const vv = v as Record<string, unknown>;
          const ok = vv && typeof vv.name === 'string' && DATA_TYPES.includes(vv.type as DataType) && vv.type !== 'any' && (vv.scope === 'cast' || vv.scope === 'persistent') && isLiteral(vv.initial);
          if (!ok) warnings.push('Dropped an invalid variable declaration.');
          return !!ok;
        })
        .map((v) => ({ ...v }))
    : [];
  const element = ELEMENTS.includes(o.element as never) ? (o.element as SpellDoc['element']) : 'arcane';
  const doc: SpellDoc = {
    format: SPELL_FORMAT,
    id: typeof o.id === 'string' && o.id ? o.id : uid('spell'),
    name: o.name.slice(0, 80),
    description: typeof o.description === 'string' ? o.description.slice(0, 2000) : '',
    author: typeof o.author === 'string' ? o.author.slice(0, 80) : undefined,
    tags: Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === 'string').slice(0, 12) : [],
    element,
    main,
    subspells,
    variables,
    extraCooldown: typeof o.extraCooldown === 'number' && o.extraCooldown >= 0 ? o.extraCooldown : undefined,
    created: typeof o.created === 'number' ? o.created : Date.now(),
    updated: typeof o.updated === 'number' ? o.updated : Date.now(),
  };
  return { doc, warnings };
}

export function exportSpell(doc: SpellDoc): string {
  return JSON.stringify(doc, null, 2);
}

export function importSpell(text: string): { doc: SpellDoc; warnings: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ImportError(`That isn't valid JSON: ${(e as Error).message}`);
  }
  return validateSpellDoc(raw);
}

/** Import a whole library export ({format:'spell-compiler/library', spells:[...]}) or a single spell. */
export function importAny(text: string): { docs: SpellDoc[]; warnings: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ImportError(`That isn't valid JSON: ${(e as Error).message}`);
  }
  const o = raw as Record<string, unknown>;
  if (o && o.format === 'spell-compiler/library' && Array.isArray(o.spells)) {
    const warnings: string[] = [];
    const docs = o.spells.map((s) => {
      const r = validateSpellDoc(s);
      warnings.push(...r.warnings);
      return r.doc;
    });
    return { docs, warnings };
  }
  const r = validateSpellDoc(raw);
  return { docs: [r.doc], warnings: r.warnings };
}

export function exportLibrary(docs: SpellDoc[]): string {
  return JSON.stringify({ format: 'spell-compiler/library', exported: Date.now(), spells: docs }, null, 2);
}

export function encodeShare(doc: SpellDoc): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(doc));
}

export function decodeShare(code: string): { doc: SpellDoc; warnings: string[] } {
  const json = LZString.decompressFromEncodedURIComponent(code.trim());
  if (!json) throw new ImportError('That share code is damaged or incomplete.');
  return importSpell(json);
}

export function cloneDoc(doc: SpellDoc): SpellDoc {
  return structuredClone(doc);
}
