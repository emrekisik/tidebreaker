import { FX, Mulberry32, TRAINING, WEAPONS, WEAPON_IDS } from '@tidebreaker/shared';
import type { ProjectileSet, ProjectileVisual } from '@tidebreaker/shared';
import type { ParticleKit } from '../render/particleKit.ts';
import type { WakeMap } from '../render/wakeMap.ts';
import { WAVE_MAX } from '../render/waves.ts';
import type { ShipEntity } from './entity.ts';
import { ParticlePool } from './particles.ts';
import { rocketHeight } from './rocketArc.ts';

const C = FX.colors;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * All cosmetic effects. Purely visual and driven by sim events and ship state; nothing here feeds
 * back into the simulation. Sim coordinates are (x, y); the world position is (x, height, y).
 *
 * Pools: `puff` = lit smoke and water, `fire` = additive flames and flashes, `spark` = additive
 * streaks, `debris` = tumbling chunks, `foam` = flat foam on the water.
 */
export class Effects {
  private readonly puff: ParticlePool;
  private readonly fire: ParticlePool;
  private readonly glow: ParticlePool;
  private readonly spark: ParticlePool;
  private readonly tracer: ParticlePool;
  private readonly debris: ParticlePool;
  private readonly foam: ParticlePool;
  private readonly rng = new Mulberry32(0x51ed1ab5);
  private readonly wakeMap: WakeMap;
  private readonly foamY = WAVE_MAX + FX.foamLift;
  /** Scratch result of spotPosition (avoids allocating a vector). */
  private spotX = 0;
  private spotZ = 0;
  /** Fractional smoke-trail time per projectile slot. */
  private readonly trailCarry: Float32Array;
  /** weapon index -> 0 bullet, 1 shell, 2 rocket (same order as ProjectileVisual) */
  private readonly kindOfWeapon: Uint8Array;

  constructor(kit: ParticleKit, projectileCapacity: number, wakeMap: WakeMap) {
    this.wakeMap = wakeMap;
    this.puff = new ParticlePool(kit.puff, -100);
    this.fire = new ParticlePool(kit.fire, -100);
    this.glow = new ParticlePool(kit.glow, -100);
    this.spark = new ParticlePool(kit.spark, -100);
    this.tracer = new ParticlePool(kit.tracer, -100);
    this.debris = new ParticlePool(kit.debris, -0.4);
    this.foam = new ParticlePool(kit.foam, -100);
    this.trailCarry = new Float32Array(projectileCapacity);
    this.kindOfWeapon = new Uint8Array(WEAPON_IDS.length);
    for (let i = 0; i < WEAPON_IDS.length; i++) {
      const v = WEAPONS[WEAPON_IDS[i]!].visual;
      this.kindOfWeapon[i] = v === 'bullet' ? 0 : v === 'shell' ? 1 : 2;
    }
  }

  update(dt: number): void {
    this.puff.update(dt);
    this.fire.update(dt);
    this.glow.update(dt);
    this.spark.update(dt);
    this.tracer.update(dt);
    this.debris.update(dt);
    this.foam.update(dt);
    // Chunks that fell into the sea throw up a little splash.
    const d = this.debris;
    for (let i = 0; i < d.landedCount; i++) {
      this.splash(d.landed[i * 2]!, d.landed[i * 2 + 1]!, 'bullet');
    }
    d.landedCount = 0;
  }

  private r(a: number, b: number): number {
    return a + (b - a) * this.rng.next();
  }

  /** Short-lived additive flash. */
  private flash(
    x: number,
    h: number,
    z: number,
    size: number,
    life: number,
    hot: number,
    cool: number,
  ): void {
    this.fire.spawn(x, h, z, 0, 0.4, 0, life, size, size * 0.25, 0, 0, hot, cool, 1, 0, 0, C.flash);
  }

  /** Shot leaves the barrel: flash, forward streaks and smoke (heavier for cannons and rockets). */
  muzzle(x: number, y: number, angle: number, visual: ProjectileVisual): void {
    const m = FX.muzzle[visual];
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    this.flash(x + dx * 0.25, 1.4, y + dz * 0.25, m.flash * 1.6, m.flashLife, C.white, C.fire);
    for (let i = 0; i < m.sparks; i++) {
      const a = angle + this.r(-0.4, 0.4);
      const sp = this.r(10, 22);
      this.spark.spawn(
        x,
        1.4,
        y,
        Math.cos(a) * sp,
        this.r(-0.5, 1.5),
        Math.sin(a) * sp,
        this.r(0.1, 0.24),
        0.1 + m.flash * 0.05,
        0.02,
        0,
        2,
        C.flash,
        C.fire,
        1,
        0,
        0,
      );
    }
    for (let i = 0; i < m.smokeCount; i++) {
      const sp = this.r(1.2, 3);
      this.puff.spawn(
        x + dx * 0.3,
        1.3,
        y + dz * 0.3,
        dx * sp + FX.wind.x * 0.4 + this.r(-0.4, 0.4),
        this.r(0.6, 1.6),
        dz * sp + FX.wind.z * 0.4 + this.r(-0.4, 0.4),
        m.smokeLife * this.r(0.8, 1.2),
        m.smoke * 0.35,
        m.smoke,
        0,
        1.4,
        C.smokeLight,
        C.smokeMid,
        0.7,
        0,
        0,
      );
    }
    if (visual === 'shell') {
      // A fast jet of gun smoke straight out of the barrel.
      this.puff.spawn(
        x + dx * 0.4,
        1.3,
        y + dz * 0.4,
        dx * 9,
        0.4,
        dz * 9,
        0.5,
        0.4,
        1.3,
        0,
        4,
        C.smokeLight,
        C.smokeMid,
        0.55,
        0,
        0,
      );
    }
    if (visual === 'rocket') {
      // Backblast behind the launcher.
      for (let i = 0; i < 4; i++) {
        const sp = this.r(2, 5);
        this.puff.spawn(
          x - dx * 0.5,
          1.2,
          y - dz * 0.5,
          -dx * sp,
          this.r(0.3, 1),
          -dz * sp,
          0.9,
          0.5,
          1.8,
          0,
          2,
          C.smokeLight,
          C.smokeMid,
          0.8,
          0,
          0,
        );
      }
      this.flash(x - dx * 0.6, 1.2, y - dz * 0.6, 1.4, 0.12, C.flash, C.fire);
    }
  }

  /** A shot hit a ship: flash, streaking sparks, hull chips and a lick of fire. */
  impact(x: number, y: number, shield: boolean, visual: ProjectileVisual): void {
    const I = FX.impact;
    const k = FX.impactScale[visual];
    const sk = Math.sqrt(k);
    if (shield) {
      this.fire.spawn(
        x,
        1.4,
        y,
        0,
        0,
        0,
        0.15 + 0.03 * k,
        I.shieldFlash[0] * sk,
        I.shieldFlash[1] * sk,
        0,
        0,
        C.shieldFlash,
        C.shieldDeep,
        0.9,
        0,
        0,
        C.shieldSpark,
      );
    } else {
      this.flash(x, 1.4, y, I.flash * sk, 0.05 + 0.02 * k, C.white, C.fire);
    }
    const n = Math.round(shield ? I.shieldSparks * sk : I.sparks * k);
    for (let i = 0; i < n; i++) {
      const a = this.r(0, Math.PI * 2);
      const sp = this.r(0.35, 1) * I.speed * sk * (shield ? 0.6 : 1);
      this.spark.spawn(
        x,
        1.3,
        y,
        Math.cos(a) * sp,
        this.r(2, 7) * sk,
        Math.sin(a) * sp,
        I.life * this.r(0.7, 1.3) * sk * (shield ? 0.7 : 1),
        0.2 * sk * (shield ? 0.7 : 1),
        0.03,
        FX.gravity,
        0.5,
        shield ? C.shieldSpark : C.flash,
        shield ? C.shieldDeep : C.fire,
        1,
        0,
        0,
        shield ? C.shieldFlash : C.hitSpark,
      );
    }
    if (!shield) {
      for (let i = 0; i < Math.round(I.chips * k); i++) {
        const a = this.r(0, Math.PI * 2);
        const sp = this.r(2, 6);
        const size = this.r(0.1, 0.2) * sk;
        const hex = this.rng.next() < 0.5 ? C.debrisA : C.debrisB;
        this.debris.spawn(
          x,
          1.3,
          y,
          Math.cos(a) * sp,
          this.r(3, 7),
          Math.sin(a) * sp,
          1.4,
          size,
          size,
          FX.gravity,
          0,
          hex,
          hex,
          1,
          1,
          this.r(-14, 14),
        );
      }
      this.fire.spawn(
        x,
        1.3,
        y,
        this.r(-0.4, 0.4),
        this.r(2, 3.2),
        this.r(-0.4, 0.4),
        0.32 + 0.06 * k,
        0.65 * k,
        0.12 * k,
        0,
        0.4,
        C.fireHot,
        C.fireDeep,
        0.95,
        0,
        0,
        C.fire,
      );
    }
    this.puff.spawn(
      x,
      1.4,
      y,
      FX.wind.x * 0.5,
      this.r(0.8, 1.6),
      FX.wind.z * 0.5,
      0.8 + 0.2 * k,
      0.4 * k * (shield ? 1 : 1.35),
      1.3 * k * (shield ? 1 : 1.35),
      0,
      1,
      C.smokeMid,
      C.smokeDark,
      0.6,
      0,
      0,
    );
    if (!shield && k > 1.5) {
      // Big hits (cannon shells, rockets) also throw up a short orange fireball.
      this.glow.spawn(
        x,
        1.4,
        y,
        0,
        0.6,
        0,
        0.28,
        I.fireball * sk * 1.4,
        I.fireball * sk * 2.2,
        0,
        0.5,
        C.fireHot,
        C.fireDeep,
        0.9,
        0,
        0,
        C.fire,
      );
    }
  }

  /** A shot landed in the water: a column of spray, droplets, a foam ring and a slow ripple. */
  splash(x: number, y: number, visual: ProjectileVisual): void {
    const sc = FX.splashScale[visual];
    const lift = Math.sqrt(sc);
    const columns = Math.max(2, Math.round(3 * sc));
    for (let i = 0; i < columns; i++) {
      this.puff.spawn(
        x + this.r(-0.2, 0.2) * sc,
        0.3,
        y + this.r(-0.2, 0.2) * sc,
        this.r(-0.5, 0.5),
        this.r(4, 7) * lift,
        this.r(-0.5, 0.5),
        this.r(0.7, 1.05),
        0.5 * sc,
        1.5 * sc,
        9,
        0.3,
        C.foam,
        C.spray,
        0.85,
        0,
        0,
      );
    }
    const drops = Math.max(3, Math.round(FX.splash.spray * sc));
    for (let i = 0; i < drops; i++) {
      const a = this.r(0, Math.PI * 2);
      const sp = this.r(1, 3);
      this.puff.spawn(
        x,
        0.3,
        y,
        Math.cos(a) * sp,
        this.r(3.5, 8) * lift,
        Math.sin(a) * sp,
        this.r(0.5, 0.9),
        0.16 * sc + 0.06,
        0.06,
        FX.gravity,
        0,
        C.foam,
        C.spray,
        0.95,
        0,
        0,
      );
    }
    for (let i = 0; i < FX.splash.foam; i++) {
      const a = this.r(0, Math.PI * 2);
      const sp = this.r(1.5, 3) * sc;
      this.foam.spawn(
        x,
        this.foamY,
        y,
        Math.cos(a) * sp,
        0,
        Math.sin(a) * sp,
        FX.splash.life,
        0.6 * sc,
        2.2 * sc,
        0,
        1.2,
        C.foam,
        C.foam,
        0.75,
        0,
        0,
      );
    }
    this.foam.spawn(
      x,
      this.foamY,
      y,
      0,
      0,
      0,
      1.7,
      1 * sc,
      3.6 * sc,
      0,
      0,
      C.foam,
      C.foam,
      0.5,
      0,
      0,
    );
  }

  /** A ship blew up: fireball, shock ring, smoke column, embers and tumbling hull chunks. */
  explode(x: number, y: number, length: number): void {
    const s = clamp(length / 4.5, 1.1, 3);
    const E = FX.explosion;
    this.flash(x, 1.6, y, 6 * s, 0.14, C.white, C.fire);
    for (let i = 0; i < E.fire; i++) {
      const a = this.r(0, Math.PI * 2);
      const rad = this.r(0, 0.15) * length;
      const sp = this.r(1.5, 3.5) * s;
      this.fire.spawn(
        x + Math.cos(a) * rad,
        this.r(0.8, 1.8),
        y + Math.sin(a) * rad,
        Math.cos(a) * sp,
        this.r(2, 6),
        Math.sin(a) * sp,
        this.r(0.5, 1.0),
        this.r(0.9, 1.5) * s,
        this.r(2.4, 3.4) * s,
        -2,
        1.5,
        C.fireHot,
        C.fireDeep,
        1,
        0,
        0,
        C.fire,
      );
    }
    for (let i = 0; i < E.smoke; i++) {
      const a = this.r(0, Math.PI * 2);
      const rad = this.r(0, 0.2) * length;
      this.puff.spawn(
        x + Math.cos(a) * rad,
        this.r(1, 2.4),
        y + Math.sin(a) * rad,
        FX.wind.x + this.r(-1, 1),
        this.r(1.8, 3.6),
        FX.wind.z + this.r(-1, 1),
        this.r(2.2, 3.6),
        1.1 * s,
        4.2 * s,
        0,
        0.5,
        C.smokeMid,
        C.smokeDark,
        0.85,
        0,
        0,
      );
    }
    for (let i = 0; i < E.sparks; i++) {
      const a = this.r(0, Math.PI * 2);
      const sp = this.r(5, 13) * s;
      this.spark.spawn(
        x,
        1.4,
        y,
        Math.cos(a) * sp,
        this.r(4, 10),
        Math.sin(a) * sp,
        this.r(0.6, 1.2),
        0.2,
        0.03,
        FX.gravity,
        0.2,
        C.flash,
        C.fire,
        1,
        0,
        0,
        C.ember,
      );
    }
    for (let i = 0; i < E.debris; i++) {
      const a = this.r(0, Math.PI * 2);
      const sp = this.r(3, 8) * Math.sqrt(s);
      const pick = this.rng.next();
      const hex = pick < 0.4 ? C.debrisA : pick < 0.75 ? C.debrisB : C.debrisC;
      const size = this.r(0.35, 0.8) * Math.pow(s, 0.6);
      this.debris.spawn(
        x,
        1.2,
        y,
        Math.cos(a) * sp,
        this.r(6, 12),
        Math.sin(a) * sp,
        2.6,
        size,
        size,
        FX.gravity,
        0,
        hex,
        hex,
        1,
        1,
        this.r(-9, 9),
      );
    }
    for (let i = 0; i < 8; i++) {
      const a = this.r(0, Math.PI * 2);
      const sp = this.r(4, 10) * Math.sqrt(s);
      const size = this.r(0.1, 0.22);
      this.debris.spawn(
        x,
        1.2,
        y,
        Math.cos(a) * sp,
        this.r(5, 12),
        Math.sin(a) * sp,
        2.2,
        size,
        size,
        FX.gravity,
        0,
        C.debrisB,
        C.debrisB,
        1,
        1,
        this.r(-16, 16),
      );
    }
    for (let i = 0; i < E.ring; i++) {
      const a = this.r(0, Math.PI * 2);
      const sp = this.r(3, 5) * s;
      this.foam.spawn(
        x,
        this.foamY,
        y,
        Math.cos(a) * sp,
        0,
        Math.sin(a) * sp,
        1.3,
        1 * s,
        6 * s,
        0,
        1,
        C.foam,
        C.foam,
        0.8,
        0,
        0,
      );
    }
    this.foam.spawn(x, this.foamY, y, 0, 0, 0, 1.1, 2 * s, 9 * s, 0, 0, C.foam, C.foam, 0.7, 0, 0);
  }

  /** Trails behind projectiles in flight. `back` = seconds between the last sim step and the drawn frame. */
  trails(set: ProjectileSet, dt: number, back: number): void {
    const R = FX.rocketTrail;
    const B = FX.bulletTrail;
    const S = FX.shellTrail;
    const N = FX.shellNose;
    const G = FX.shellGlow;
    for (let i = 0; i < set.highWater; i++) {
      if (set.active[i] === 0) continue;
      const w = set.weapon[i]!;
      const kind = this.kindOfWeapon[w]!;
      const every = kind === 0 ? B.everySec : kind === 1 ? S.everySec : R.everySec;
      let carry = this.trailCarry[i]! + dt;
      while (carry >= every) {
        carry -= every;
        const vx = set.vx[i]!;
        const vz = set.vy[i]!;
        const sp = Math.sqrt(vx * vx + vz * vz) || 1;
        // Where the projectile is drawn this frame (between the last two sim steps).
        // The spawn happened `carry` seconds ago within this frame, so spread it along the path.
        const px = set.x[i]! - vx * (back + carry);
        const pz = set.y[i]! - vz * (back + carry);
        const dx = vx / sp;
        const dz = vz / sp;
        if (kind === 0) {
          // Glowing streak that trails behind the tracer.
          this.tracer.spawn(
            px,
            1.2,
            pz,
            vx * -0.3,
            0,
            vz * -0.3,
            B.life,
            B.size,
            B.size * 0.2,
            0,
            0,
            C.flash,
            C.fire,
            0.9,
            0,
            0,
          );
        } else if (kind === 1) {
          // Cannon: a thick, glowing streak like the machine gun's, plus a little air-glow at the nose.
          this.tracer.spawn(
            px,
            1.2,
            pz,
            vx * -0.3,
            0,
            vz * -0.3,
            S.life,
            S.streak,
            S.streak * 0.2,
            0,
            0,
            C.flash,
            C.shellTail,
            0.95,
            0,
            0,
            C.flash,
          );
          // Soft yellow halo around the shell, like the rocket's exhaust glow. Only every few
          // ticks, so the additive blobs do not pile up into a white bar over bright water.
          if (this.rng.next() < G.chance) {
            this.glow.spawn(
              px + dx * 0.3,
              1.2,
              pz + dz * 0.3,
              0,
              0,
              0,
              G.life,
              G.size,
              G.endSize,
              0,
              0,
              C.shellGlow,
              C.shellTail,
              G.alpha,
              0,
              0,
            );
          }
          this.fire.spawn(
            px + dx * 0.8,
            1.2,
            pz + dz * 0.8,
            0,
            0,
            0,
            N.life,
            N.size,
            N.size * 0.4,
            0,
            0,
            C.flash,
            C.fireHot,
            0.7,
            0,
            0,
            C.fireHot,
          );
        } else {
          const u = 1 - (set.remaining[i]! + sp * back) / WEAPONS[WEAPON_IDS[w]!].range;
          const py = rocketHeight(u);
          // Smoke trail.
          this.puff.spawn(
            px - dx * 0.5,
            py,
            pz - dz * 0.5,
            vx * -0.04 + FX.wind.x * 0.3 + this.r(-0.3, 0.3),
            this.r(0.2, 0.7),
            vz * -0.04 + FX.wind.z * 0.3 + this.r(-0.3, 0.3),
            R.life * this.r(0.8, 1.2),
            R.startSize,
            R.endSize,
            0,
            1.2,
            C.smokeLight,
            C.smokeMid,
            0.65,
            0,
            0,
          );
          // Burning exhaust: a hot flare at the nozzle, a streak of flame behind it and a glow.
          const nx = px - dx * 0.65;
          const nz = pz - dz * 0.65;
          this.fire.spawn(
            nx,
            py,
            nz,
            0,
            0,
            0,
            0.12,
            0.95,
            0.15,
            0,
            0,
            C.white,
            C.fireDeep,
            1,
            0,
            0,
            C.fire,
          );
          this.spark.spawn(
            nx,
            py,
            nz,
            vx * -0.55,
            0,
            vz * -0.55,
            0.12,
            0.3,
            0.08,
            0,
            0,
            C.flash,
            C.fire,
            1,
            0,
            0,
            C.fireHot,
          );
          this.glow.spawn(nx, py, nz, 0, 0, 0, 0.1, 3.2, 1.2, 0, 0, C.glow, C.fireDeep, 0.5, 0, 0);
        }
      }
      this.trailCarry[i] = carry;
    }
  }

  /** Two ships hit each other: flash, sparks, hull chips, a splash and foam at the contact. */
  collision(x: number, y: number, impact: number): void {
    const K = FX.collision;
    this.flash(x, 1.4, y, 1.4 + impact * 0.12, 0.12, C.white, C.fire);
    const n = Math.min(K.sparksMax, Math.round(K.sparksBase + impact * K.sparksPerSpeed));
    for (let i = 0; i < n; i++) {
      const a = this.r(0, Math.PI * 2);
      const sp = this.r(0.4, 1) * (6 + impact * 0.5);
      this.spark.spawn(
        x,
        1.2,
        y,
        Math.cos(a) * sp,
        this.r(2, 8),
        Math.sin(a) * sp,
        this.r(0.3, 0.6),
        0.14,
        0.03,
        FX.gravity,
        0.4,
        C.flash,
        C.fire,
        1,
        0,
        0,
        C.hitSpark,
      );
    }
    for (let i = 0; i < K.chips; i++) {
      const a = this.r(0, Math.PI * 2);
      const sp = this.r(2, 6);
      const size = this.r(0.12, 0.28);
      const hex = this.rng.next() < 0.5 ? C.debrisA : C.debrisB;
      this.debris.spawn(
        x,
        1.2,
        y,
        Math.cos(a) * sp,
        this.r(3, 8),
        Math.sin(a) * sp,
        1.6,
        size,
        size,
        FX.gravity,
        0,
        hex,
        hex,
        1,
        1,
        this.r(-14, 14),
      );
    }
    this.puff.spawn(
      x,
      1.3,
      y,
      FX.wind.x * 0.5,
      this.r(1, 2),
      FX.wind.z * 0.5,
      1.3,
      0.6,
      1.9,
      0,
      0.8,
      C.smokeMid,
      C.smokeDark,
      0.7,
      0,
      0,
    );
    this.foam.spawn(
      x,
      this.foamY,
      y,
      0,
      0,
      0,
      1.4,
      1.2,
      3 + impact * 0.2,
      0,
      0,
      C.foam,
      C.foam,
      0.7,
      0,
      0,
    );
    if (impact > K.splashAbove) this.splash(x, y, 'shell');
  }

  /** Per-frame effects tied to a ship: its wake, damage smoke/fire and the sinking burn. */
  ship(e: ShipEntity, dt: number): void {
    const s = e.combatant.state;
    const def = e.combatant.def;
    const p = e.pose;
    const length = def.length;
    const width = this.widthOf(e);

    if (s.alive && Math.abs(s.speed) > 0.8) this.wake(e, dt, length, width);
    else e.wakeReady = false;

    const frac = s.hull / def.hull;
    const D = FX.damage;
    if (frac >= 1) e.spotsReady = false;
    else if (!e.spotsReady) this.pickSpots(e, length, width);
    if (s.alive) {
      if (frac < D.smokeBelow) {
        const worse = (D.smokeBelow - frac) / D.smokeBelow;
        e.smokeCarry += D.smokeRate * Math.max(0.8, length / 10) * (1 + worse * 2) * dt;
        while (e.smokeCarry >= 1) {
          e.smokeCarry -= 1;
          this.shipSmoke(e, p.x, p.y, p.heading, length, frac < D.fireBelow);
        }
      }
      if (frac < D.fireBelow) {
        e.fireCarry += D.fireRate * Math.max(0.8, length / 10) * dt;
        while (e.fireCarry >= 1) {
          e.fireCarry -= 1;
          this.shipFire(e, p.x, p.y, p.heading, length);
        }
      }
    } else if (e.sinkSeconds < TRAINING.sinkAnimSec) {
      const left = 1 - e.sinkSeconds / TRAINING.sinkAnimSec;
      e.smokeCarry += FX.sinkingSmokeRate * left * Math.max(0.8, length / 10) * dt;
      e.fireCarry += FX.sinkingFireRate * left * Math.max(0.8, length / 10) * dt;
      while (e.smokeCarry >= 1) {
        e.smokeCarry -= 1;
        this.shipSmoke(e, p.x, p.y, p.heading, length, true);
      }
      while (e.fireCarry >= 1) {
        e.fireCarry -= 1;
        this.shipFire(e, p.x, p.y, p.heading, length);
      }
    }
  }

  private widthOf(e: ShipEntity): number {
    const circles = e.combatant.def.hitCircles;
    let r = 0;
    for (let i = 0; i < circles.length; i++) r = Math.max(r, circles[i]!.radius);
    return r * 2;
  }

  /** Picks the few places on a ship where it smokes and burns (kept until it is repaired). */
  private pickSpots(e: ShipEntity, length: number, width: number): void {
    for (let i = 0; i < 3; i++) {
      e.spots[i * 2] = this.r(-0.32, 0.32) * length;
      e.spots[i * 2 + 1] = this.r(-0.12, 0.12) * width;
    }
    e.spotsReady = true;
  }

  private spotPosition(e: ShipEntity, x: number, y: number, heading: number): void {
    const i = Math.floor(this.rng.next() * 3) % 3;
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    const fwd = e.spots[i * 2]! + this.r(-0.04, 0.04) * e.combatant.def.length;
    const side = e.spots[i * 2 + 1]!;
    this.spotX = x + c * fwd - s * side;
    this.spotZ = y + s * fwd + c * side;
  }

  private shipSmoke(
    e: ShipEntity,
    x: number,
    y: number,
    heading: number,
    length: number,
    dark: boolean,
  ): void {
    this.spotPosition(e, x, y, heading);
    const k = clamp(length / 7, 0.8, 1.9);
    this.puff.spawn(
      this.spotX,
      1.8,
      this.spotZ,
      FX.wind.x * 0.8 + this.r(-0.3, 0.3),
      this.r(1.4, 2.6),
      FX.wind.z * 0.8 + this.r(-0.3, 0.3),
      FX.damage.smokeLife * this.r(0.9, 1.5),
      0.5 * k,
      (dark ? 3.4 : 2.4) * k,
      0,
      0.45,
      dark ? C.smokeDark : C.smokeMid,
      dark ? C.smokeMid : C.smokeLight,
      dark ? 0.75 : 0.5,
      0,
      0,
    );
  }

  /** Flames: a white-hot core fading to orange and dark red, with a faint glow around it. */
  private shipFire(e: ShipEntity, x: number, y: number, heading: number, length: number): void {
    this.spotPosition(e, x, y, heading);
    const px = this.spotX;
    const pz = this.spotZ;
    const k = clamp(length / 6, 0.9, 1.9);
    this.fire.spawn(
      px,
      1.4,
      pz,
      this.r(-0.6, 0.6),
      this.r(2.2, 3.6),
      this.r(-0.6, 0.6),
      this.r(0.45, 0.85),
      1.5 * k,
      0.2 * k,
      0,
      0.25,
      C.fireHot,
      C.fireDeep,
      1,
      0,
      0,
      C.fire,
    );
    if (this.rng.next() < 0.5) {
      this.glow.spawn(
        px,
        1.3,
        pz,
        0,
        0.8,
        0,
        0.45,
        5 * k,
        2.5 * k,
        0,
        0,
        C.glow,
        C.fireDeep,
        0.4,
        0,
        0,
      );
    }
    if (this.rng.next() < 0.3) {
      this.spark.spawn(
        px,
        1.6,
        pz,
        this.r(-1.5, 1.5),
        this.r(3, 7),
        this.r(-1.5, 1.5),
        this.r(0.6, 1.1),
        0.12,
        0.02,
        FX.gravity * 0.5,
        0.2,
        C.flash,
        C.fire,
        1,
        0,
        0,
        C.ember,
      );
    }
  }

  /**
   * Ship wake, stamped into the foam map as scattered blobs: a ragged turbulent trail behind the
   * stern and a steady foam fringe along the bow sides. The map fades and
   * spreads it, so it curves with the ship and dissolves into lace. Bow spray stays particles.
   */
  private wake(e: ShipEntity, dt: number, length: number, width: number): void {
    const W = FX.wake;
    const s = e.combatant.state;
    const p = e.pose;
    const c = Math.cos(p.heading);
    const sn = Math.sin(p.heading);
    const speedFrac = clamp(Math.abs(s.speed) / e.combatant.def.vMax, 0, 1);
    const half = width * 0.5;

    // Core of the trail: from where the stern was last frame to where it is now.
    const sx = p.x - c * length * W.sternAt;
    const sz = p.y - sn * length * W.sternAt;
    let px = e.wakeX;
    let pz = e.wakeZ;
    if (!e.wakeReady || (sx - px) * (sx - px) + (sz - pz) * (sz - pz) > 36) {
      px = sx;
      pz = sz;
    }
    e.wakeX = sx;
    e.wakeZ = sz;
    e.wakeReady = true;
    const strength = W.trailMin + (1 - W.trailMin) * speedFrac;
    this.wakeMap.capsule(px, pz, sx, sz, half * W.trailWidth + 0.2, strength, 0, strength, 0);

    // Scattered blobs, one set per `blobSpacing` of travel: ragged trail edges, bow-side foam and
    // a broken Kelvin spread. Random placement keeps the shape from reading as geometric.
    e.blobCarry += Math.abs(s.speed) * dt;
    const fx = p.x + c * length * W.bowAt;
    const fz = p.y + sn * length * W.bowAt;
    while (e.blobCarry >= W.blobSpacing) {
      e.blobCarry -= W.blobSpacing;
      const back = this.r(0, 1);
      const lat = this.r(-1, 1) * half * W.blobSpread;
      const bx = sx + (px - sx) * back - sn * lat;
      const bz = sz + (pz - sz) * back + c * lat;
      const rv = strength * this.r(0.4, 0.9);
      this.wakeMap.capsule(bx, bz, bx, bz, half * this.r(0.25, 0.6) + 0.25, rv, 0, rv, 0);
    }

    if (speedFrac > W.bowMinSpeed) {
      // A short, steady fringe of foam on each side of the bow (re-stamped every frame, so it
      // never blinks). The map's noise breaks it up, so it stays loose instead of a straight line.
      const gf = (W.bowMin + (1 - W.bowMin) * speedFrac) * W.fringeStrength;
      for (let side = -1; side <= 1; side += 2) {
        const ox = -sn * side * half;
        const oz = c * side * half;
        this.wakeMap.capsule(
          fx - c * length * 0.04 + ox * 0.75,
          fz - sn * length * 0.04 + oz * 0.75,
          fx - c * length * W.fringeLength + ox * 1.15,
          fz - sn * length * W.fringeLength + oz * 1.15,
          half * 0.45 + 0.25,
          0,
          gf,
          0,
          gf * 0.6,
        );
      }
    }
  }
}
