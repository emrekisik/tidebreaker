import { FX, Mulberry32, TRAINING, WEAPONS, WEAPON_IDS } from '@tidebreaker/shared';
import type { ProjectileSet, ProjectileVisual } from '@tidebreaker/shared';
import type { ParticleKit } from '../render/particleKit.ts';
import { WAVE_MAX } from '../render/waves.ts';
import type { ShipEntity } from './entity.ts';
import { ParticlePool } from './particles.ts';

const C = FX.colors;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * All cosmetic effects (muzzle flash, smoke, sparks, splashes, fire, debris, wakes). Purely
 * visual and driven by sim events and ship state; nothing here feeds back into the simulation.
 * Sim coordinates are (x, y); the world position is (x, height, y).
 */
export class Effects {
  private readonly puff: ParticlePool;
  private readonly spark: ParticlePool;
  private readonly debris: ParticlePool;
  private readonly foam: ParticlePool;
  private readonly rng = new Mulberry32(0x51ed1ab5);
  private readonly foamY = WAVE_MAX + FX.foamLift;
  /** Fractional smoke-trail time per projectile slot. */
  private readonly trailCarry: Float32Array;
  /** weapon index -> 1 when it is a rocket */
  private readonly isRocket: Uint8Array;

  constructor(kit: ParticleKit, projectileCapacity: number) {
    this.puff = new ParticlePool(kit.puff, -100);
    this.spark = new ParticlePool(kit.spark, -100);
    this.debris = new ParticlePool(kit.debris, -0.6);
    this.foam = new ParticlePool(kit.foam, -100);
    this.trailCarry = new Float32Array(projectileCapacity);
    this.isRocket = new Uint8Array(WEAPON_IDS.length);
    for (let i = 0; i < WEAPON_IDS.length; i++) {
      this.isRocket[i] = WEAPONS[WEAPON_IDS[i]!].visual === 'rocket' ? 1 : 0;
    }
  }

  update(dt: number): void {
    this.puff.update(dt);
    this.spark.update(dt);
    this.debris.update(dt);
    this.foam.update(dt);
  }

  private r(a: number, b: number): number {
    return a + (b - a) * this.rng.next();
  }

  /** Shot leaves the barrel: flash plus a puff of smoke (heavier for cannons and rockets). */
  muzzle(x: number, y: number, angle: number, visual: ProjectileVisual): void {
    const m = FX.muzzle[visual];
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    this.spark.spawn(
      x + dx * 0.2,
      1.4,
      y + dz * 0.2,
      dx * 6,
      0,
      dz * 6,
      m.flashLife,
      m.flash,
      m.flash * 0.2,
      0,
      0,
      C.flash,
      C.fire,
      1,
      0,
      0,
    );
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
    if (visual === 'rocket') {
      // Backblast behind the launcher.
      for (let i = 0; i < 3; i++) {
        const sp = this.r(2, 4);
        this.puff.spawn(
          x - dx * 0.5,
          1.2,
          y - dz * 0.5,
          -dx * sp,
          this.r(0.3, 1),
          -dz * sp,
          0.8,
          0.5,
          1.6,
          0,
          2,
          C.smokeLight,
          C.smokeMid,
          0.8,
          0,
          0,
        );
      }
    }
  }

  /** A shot hit a ship: a burst of sparks (cyan on the shield, orange on the hull). */
  impact(x: number, y: number, shield: boolean): void {
    const n = shield ? FX.impact.shieldSparks : FX.impact.sparks;
    for (let i = 0; i < n; i++) {
      const a = this.r(0, Math.PI * 2);
      const sp = this.r(0.35, 1) * FX.impact.speed;
      this.spark.spawn(
        x,
        1.3,
        y,
        Math.cos(a) * sp,
        this.r(2, 6),
        Math.sin(a) * sp,
        FX.impact.life * this.r(0.7, 1.2),
        0.3,
        0.05,
        FX.gravity,
        0.3,
        shield ? C.shieldSpark : C.hitSpark,
        shield ? C.foam : C.fire,
        1,
        0,
        0,
      );
    }
    this.puff.spawn(
      x,
      1.4,
      y,
      FX.wind.x * 0.5,
      this.r(0.8, 1.6),
      FX.wind.z * 0.5,
      0.9,
      0.4,
      1.1,
      0,
      1,
      C.smokeMid,
      C.smokeDark,
      0.6,
      0,
      0,
    );
  }

  /** A shot landed in the water. */
  splash(x: number, y: number, visual: ProjectileVisual): void {
    const sc = FX.splashScale[visual];
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
    const spray = Math.max(2, Math.round(FX.splash.spray * sc));
    for (let i = 0; i < spray; i++) {
      const a = this.r(0, Math.PI * 2);
      const sp = this.r(0.5, 2);
      this.spark.spawn(
        x,
        0.2,
        y,
        Math.cos(a) * sp,
        this.r(4, 8) * Math.sqrt(sc),
        Math.sin(a) * sp,
        this.r(0.6, 1),
        0.32 * sc + 0.08,
        0.08,
        FX.gravity,
        0,
        C.spray,
        C.foam,
        0.9,
        0,
        0,
      );
    }
  }

  /** A ship blew up: fire, smoke, embers and tumbling low-poly chunks. */
  explode(x: number, y: number, length: number): void {
    const s = clamp(length / 4.5, 1.1, 3);
    const E = FX.explosion;
    for (let i = 0; i < E.fire; i++) {
      const a = this.r(0, Math.PI * 2);
      const rad = this.r(0, 0.15) * length;
      const sp = this.r(1.5, 3.5) * s;
      this.puff.spawn(
        x + Math.cos(a) * rad,
        this.r(0.8, 1.8),
        y + Math.sin(a) * rad,
        Math.cos(a) * sp,
        this.r(2, 5),
        Math.sin(a) * sp,
        this.r(0.5, 0.9),
        0.9 * s,
        2.4 * s,
        0,
        1.5,
        this.rng.next() < 0.5 ? C.fireHot : C.fire,
        C.smokeDark,
        1,
        0,
        0,
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
        this.r(1.5, 3),
        FX.wind.z + this.r(-1, 1),
        this.r(1.8, 2.8),
        1 * s,
        3.4 * s,
        0,
        0.6,
        C.smokeMid,
        C.smokeDark,
        0.75,
        0,
        0,
      );
    }
    for (let i = 0; i < E.sparks; i++) {
      const a = this.r(0, Math.PI * 2);
      const sp = this.r(4, 10) * s;
      this.spark.spawn(
        x,
        1.4,
        y,
        Math.cos(a) * sp,
        this.r(4, 9),
        Math.sin(a) * sp,
        this.r(0.6, 1.1),
        0.36,
        0.05,
        FX.gravity,
        0.2,
        C.ember,
        C.fire,
        1,
        0,
        0,
      );
    }
    for (let i = 0; i < E.debris; i++) {
      const a = this.r(0, Math.PI * 2);
      const sp = this.r(3, 8) * Math.sqrt(s);
      const pick = this.rng.next();
      const hex = pick < 0.4 ? C.debrisA : pick < 0.75 ? C.debrisB : C.debrisC;
      const size = this.r(0.35, 0.75) * Math.pow(s, 0.6);
      this.debris.spawn(
        x,
        1.2,
        y,
        Math.cos(a) * sp,
        this.r(6, 11),
        Math.sin(a) * sp,
        2.4,
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
  }

  /** Smoke trail behind every rocket in flight. */
  trails(set: ProjectileSet, dt: number): void {
    const T = FX.rocketTrail;
    for (let i = 0; i < set.highWater; i++) {
      if (set.active[i] === 0 || this.isRocket[set.weapon[i]!] === 0) continue;
      let carry = this.trailCarry[i]! + dt;
      while (carry >= T.everySec) {
        carry -= T.everySec;
        this.puff.spawn(
          set.x[i]!,
          1.2,
          set.y[i]!,
          set.vx[i]! * -0.04 + FX.wind.x * 0.3 + this.r(-0.3, 0.3),
          this.r(0.2, 0.7),
          set.vy[i]! * -0.04 + FX.wind.z * 0.3 + this.r(-0.3, 0.3),
          T.life * this.r(0.8, 1.2),
          T.startSize,
          T.endSize,
          0,
          1.2,
          C.smokeLight,
          C.smokeMid,
          0.65,
          0,
          0,
        );
      }
      this.trailCarry[i] = carry;
    }
  }

  /** Per-frame effects tied to a ship: its wake, damage smoke/fire and the sinking burn. */
  ship(e: ShipEntity, dt: number): void {
    const s = e.combatant.state;
    const def = e.combatant.def;
    const p = e.pose;
    const length = def.length;
    const width = this.widthOf(e);

    if (s.alive && s.speed > 0.8) this.wake(e, dt, length, width);

    const frac = s.hull / def.hull;
    const D = FX.damage;
    if (s.alive) {
      if (frac < D.smokeBelow) {
        const worse = (D.smokeBelow - frac) / D.smokeBelow;
        e.smokeCarry += D.smokeRate * (length / 10) * (1 + worse * 2) * dt;
        while (e.smokeCarry >= 1) {
          e.smokeCarry -= 1;
          this.shipSmoke(p.x, p.y, p.heading, length, width, frac < D.fireBelow);
        }
      }
      if (frac < D.fireBelow) {
        e.fireCarry += D.fireRate * (length / 10) * dt;
        while (e.fireCarry >= 1) {
          e.fireCarry -= 1;
          this.shipFire(p.x, p.y, p.heading, length, width);
        }
      }
    } else if (e.sinkSeconds < TRAINING.sinkAnimSec) {
      const left = 1 - e.sinkSeconds / TRAINING.sinkAnimSec;
      e.smokeCarry += FX.sinkingSmokeRate * left * (length / 10) * dt;
      e.fireCarry += FX.sinkingFireRate * left * (length / 10) * dt;
      while (e.smokeCarry >= 1) {
        e.smokeCarry -= 1;
        this.shipSmoke(p.x, p.y, p.heading, length, width, true);
      }
      while (e.fireCarry >= 1) {
        e.fireCarry -= 1;
        this.shipFire(p.x, p.y, p.heading, length, width);
      }
    }
  }

  private widthOf(e: ShipEntity): number {
    const circles = e.combatant.def.hitCircles;
    let r = 0;
    for (let i = 0; i < circles.length; i++) r = Math.max(r, circles[i]!.radius);
    return r * 2;
  }

  private shipSmoke(
    x: number,
    y: number,
    heading: number,
    length: number,
    width: number,
    dark: boolean,
  ): void {
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    const fwd = this.r(-0.35, 0.35) * length;
    const side = this.r(-0.2, 0.2) * width;
    const k = clamp(length / 8, 0.7, 1.8);
    this.puff.spawn(
      x + c * fwd - s * side,
      1.8,
      y + s * fwd + c * side,
      FX.wind.x * 0.8 + this.r(-0.3, 0.3),
      this.r(1.2, 2.2),
      FX.wind.z * 0.8 + this.r(-0.3, 0.3),
      FX.damage.smokeLife * this.r(0.8, 1.3),
      0.5 * k,
      2.2 * k,
      0,
      0.5,
      dark ? C.smokeDark : C.smokeMid,
      dark ? C.smokeMid : C.smokeLight,
      dark ? 0.85 : 0.6,
      0,
      0,
    );
  }

  private shipFire(x: number, y: number, heading: number, length: number, width: number): void {
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    const fwd = this.r(-0.3, 0.3) * length;
    const side = this.r(-0.15, 0.15) * width;
    const k = clamp(length / 8, 0.7, 1.6);
    const px = x + c * fwd - s * side;
    const pz = y + s * fwd + c * side;
    this.puff.spawn(
      px,
      1.5,
      pz,
      this.r(-0.3, 0.3),
      this.r(2, 3.2),
      this.r(-0.3, 0.3),
      this.r(0.35, 0.6),
      0.75 * k,
      0.15 * k,
      0,
      0.3,
      C.fireHot,
      C.fire,
      1,
      0,
      0,
    );
    if (this.rng.next() < 0.25) {
      this.spark.spawn(
        px,
        1.6,
        pz,
        this.r(-1.5, 1.5),
        this.r(3, 6),
        this.r(-1.5, 1.5),
        this.r(0.5, 0.9),
        0.22,
        0.05,
        FX.gravity * 0.5,
        0.2,
        C.ember,
        C.fire,
        1,
        0,
        0,
      );
    }
  }

  /** Foam diamonds behind the stern (center line plus a spreading V) and at the bow. */
  private wake(e: ShipEntity, dt: number, length: number, width: number): void {
    const W = FX.wake;
    const s = e.combatant.state;
    const p = e.pose;
    const c = Math.cos(p.heading);
    const sn = Math.sin(p.heading);
    const wscale = width / 1.6;
    const distance = s.speed * dt;

    e.wakeCarry += distance;
    while (e.wakeCarry >= W.spacing) {
      e.wakeCarry -= W.spacing;
      const sx = p.x - c * length * 0.46;
      const sz = p.y - sn * length * 0.46;
      const jitter = this.r(-0.1, 0.1) * width;
      const lx = sx - sn * jitter;
      const lz = sz + c * jitter;
      this.foam.spawn(
        lx,
        this.foamY,
        lz,
        -c * 0.4,
        0,
        -sn * 0.4,
        W.life,
        W.startSize * wscale,
        W.endSize * wscale,
        0,
        0.8,
        C.foam,
        C.foam,
        W.alpha,
        0,
        0,
      );
      const arm = W.armSpeed * Math.sqrt(wscale);
      this.foam.spawn(
        lx,
        this.foamY,
        lz,
        -sn * arm - c * 0.3,
        0,
        c * arm - sn * 0.3,
        W.life * 0.8,
        W.startSize * 0.8 * wscale,
        W.endSize * 0.9 * wscale,
        0,
        0.9,
        C.foam,
        C.foam,
        W.alpha * 0.8,
        0,
        0,
      );
      this.foam.spawn(
        lx,
        this.foamY,
        lz,
        sn * arm - c * 0.3,
        0,
        -c * arm - sn * 0.3,
        W.life * 0.8,
        W.startSize * 0.8 * wscale,
        W.endSize * 0.9 * wscale,
        0,
        0.9,
        C.foam,
        C.foam,
        W.alpha * 0.8,
        0,
        0,
      );
    }

    if (s.speed > W.bowMinSpeed * e.combatant.def.vMax) {
      e.bowCarry += distance;
      while (e.bowCarry >= W.bowSpacing) {
        e.bowCarry -= W.bowSpacing;
        const bx = p.x + c * length * 0.42;
        const bz = p.y + sn * length * 0.42;
        const side = width * 0.4;
        this.foam.spawn(
          bx - sn * side,
          this.foamY,
          bz + c * side,
          -sn * 0.9 - c * 0.5,
          0,
          c * 0.9 - sn * 0.5,
          W.bowLife,
          0.4 * wscale,
          1.2 * wscale,
          0,
          0.8,
          C.foam,
          C.foam,
          W.alpha,
          0,
          0,
        );
        this.foam.spawn(
          bx + sn * side,
          this.foamY,
          bz - c * side,
          sn * 0.9 - c * 0.5,
          0,
          -c * 0.9 - sn * 0.5,
          W.bowLife,
          0.4 * wscale,
          1.2 * wscale,
          0,
          0.8,
          C.foam,
          C.foam,
          W.alpha,
          0,
          0,
        );
      }
    }
  }
}
