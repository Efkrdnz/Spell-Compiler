import { autoLayout } from '../core/layout';
import { SPELL_FORMAT, type DataType, type Element, type Literal, type SpellDoc, type SpellGraph, type VarDecl } from '../core/types';

/**
 * Tiny DSL for authoring spells in code (examples, blueprints, tests).
 *
 *   const s = new SpellBuilder('fireball', 'Fireball', 'fire');
 *   const cast = s.node('onCast');
 *   const p = s.node('projectile', { element: 'fire' });
 *   s.flow(cast, 'then', p);
 */
export class GraphBuilder {
  private n = 0;
  constructor(readonly graph: SpellGraph) {}

  node(type: string, values: Record<string, Literal> = {}, id?: string): string {
    const nid = id ?? `${this.graph.id}_${type}_${++this.n}`;
    this.graph.nodes.push({ id: nid, type, x: 0, y: 0, values });
    return nid;
  }

  /** exec connection: from.port -> to.in */
  flow(from: string, port: string, to: string, toPort = 'in'): this {
    this.graph.edges.push({ id: `e_${from}_${port}_${to}_${toPort}_${this.graph.edges.length}`, from, fromPort: port, to, toPort });
    return this;
  }

  /** data connection */
  data(from: string, fromPort: string, to: string, toPort: string): this {
    return this.flow(from, fromPort, to, toPort);
  }
}

export class SpellBuilder extends GraphBuilder {
  readonly doc: SpellDoc;
  constructor(id: string, name: string, element: Element, description = '', tags: string[] = []) {
    const main: SpellGraph = { id: 'main', name: 'Main', nodes: [], edges: [] };
    super(main);
    this.doc = {
      format: SPELL_FORMAT,
      id,
      name,
      description,
      tags,
      element,
      author: 'Spell Compiler',
      main,
      subspells: [],
      variables: [],
      created: 0,
      updated: 0,
    };
  }

  variable(name: string, type: VarDecl['type'], initial: Literal, scope: VarDecl['scope'] = 'cast'): this {
    this.doc.variables.push({ name, type, initial, scope });
    return this;
  }

  subspell(id: string, name: string, params: { id: string; name: string; type: DataType }[]): GraphBuilder {
    const g: SpellGraph = { id, name, nodes: [], edges: [], params };
    this.doc.subspells.push(g);
    return new GraphBuilder(g);
  }

  build(layout = true): SpellDoc {
    if (layout) {
      autoLayout(this.doc.main, { doc: this.doc, graph: this.doc.main });
      for (const s of this.doc.subspells) autoLayout(s, { doc: this.doc, graph: s });
    }
    return this.doc;
  }
}
