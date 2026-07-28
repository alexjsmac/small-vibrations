import * as THREE from 'three';
import type { Viz, VizContext, AudioFrame, VizModule } from '../types';
import { STERILE_VERT, buildSterileFragment } from './sterileShader';
import { paramsAt, sterileAt, zoomAt } from './sections';
import { mulberry32 } from '../random';

/**
 * "Sterile Breath" — a living, breathing dark field is slowly, irreversibly
 * overtaken by a cold sterile blank: the track's antiseptic erasure of
 * life, rendered as an advancing bleach front across the frame.
 *
 * Increment 1 scaffold ONLY: this file establishes the final module shape
 * (own scene/ortho camera/fullscreen quad, quality-gated shader-budget
 * constants read once at construction, `?solo=` plumbing) driving a
 * deliberately trivial fragment (sterileShader.ts's dark-ground/pale-blank
 * split). The real layers — biomass field, the advancing front's shape,
 * strike/bloom/poke/ripple events, ghost trails — land in increments 2-8
 * on top of this skeleton; nothing here is meant to look finished yet.
 *
 * Debug: `?solo=<0-5>` selects a solo layer (0 = full composed scene,
 * default; 1 biomass / 2 front / 3 events / 4 ghosts land in later
 * increments and currently fall through to the composed scene; 5 sterile
 * forces the cold blank full-screen — already wired end to end so the
 * switch itself is proven real), plus the standard `?t=`, `?q=`, `?debug=1`
 * handled outside this module (VizHost / QualityManager).
 */
class SterileBreath implements Viz {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;
  private quad!: THREE.Mesh;
  private material!: THREE.ShaderMaterial;

  private rand!: () => number;
  private full = true;

  /** Cover-fit scale (keeps the world square regardless of viewport aspect) — same idiom as b2's `cover`. */
  private cover = new THREE.Vector2(1, 1);

  /**
   * Latest paramsAt(songTime) result — stashed each frame but not yet
   * consumed anywhere; increments 2-8 will read act params off this to
   * drive the real layers. Referenced with `void` below purely to mark the
   * write as deliberate, not dead code.
   */
  private section: ReturnType<typeof paramsAt> | null = null;

  init(ctx: VizContext) {
    const { renderer, seed, quality } = ctx;
    this.renderer = renderer;
    this.rand = mulberry32(seed ^ 0xb35d7e21);
    this.full = quality.level === 'full';

    const soloParam = new URLSearchParams(location.search).get('solo');
    const parsedSolo = soloParam !== null ? parseInt(soloParam, 10) : NaN;
    const soloMode = Number.isFinite(parsedSolo) ? parsedSolo : 0;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.material = new THREE.ShaderMaterial({
      vertexShader: STERILE_VERT,
      fragmentShader: buildSterileFragment({
        strikeSlots: this.full ? 8 : 6,
        bloomSlots: 3,
        pokeSlots: 4,
        rippleSlots: 4,
        lobes: this.full ? 5 : 3,
        fbmOct: this.full ? 3 : 2,
      }),
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uCover: { value: new THREE.Vector2(1, 1) },
        uZoom: { value: 1 },
        uPan: { value: new THREE.Vector2(0, 0) },
        uTime: { value: 0 },
        uSterile: { value: 0 },
        uSoloMode: { value: soloMode },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.quad);

    const canvas = renderer.domElement;
    this.resize(canvas.clientWidth || 1, canvas.clientHeight || 1);
  }

  update(dt: number, audio: AudioFrame) {
    const songTime = audio.time;
    const u = this.material.uniforms;
    u.uTime.value += dt;
    u.uSterile.value = sterileAt(songTime);
    u.uZoom.value = zoomAt(songTime);

    // Not consumed yet — see the `section` field's doc comment.
    this.section = paramsAt(songTime);
    void this.section;
  }

  resize(w: number, h: number) {
    if (!this.material || w <= 0 || h <= 0) return;
    const aspect = Math.min(3.5, Math.max(0.28, w / h));
    // Keep the world square regardless of viewport aspect (b2's uCover idiom).
    if (aspect >= 1) this.cover.set(aspect, 1);
    else this.cover.set(1, 1 / aspect);
    (this.material.uniforms.uCover.value as THREE.Vector2).copy(this.cover);
  }

  render() {
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.material.dispose();
    this.quad.geometry.dispose();
    this.renderer.setRenderTarget(null);
  }
}

const mod: VizModule = { default: () => new SterileBreath() };
export default mod.default;
