import { isMutedByUrl } from '../../../shared/mute-param';
import { readUrlState, writeUrlState } from '../../../shared/url-state';
import { paramOneOf } from '../../../shared/url-params';
import type { PanelSection } from '../../../shared/debug-panel';
import type { CarDef } from '../cars/shared/types';
import { CarAudio, type CarSoundFrame } from '../game/audio';
import { CAMERA_MODES } from '../game/camera-rig';
import { SURFACES, type SurfaceId } from '../physics/surfaces';

/**
 * Car viewer "Sound" section: drives a CarAudio for the shown car without driving it (rpm, throttle / pedal, gear,
 * speed, slide + surface, lock-up, impact, listener, tunnel). Silent until "Sound on" (the click is the gesture);
 * `?mute=1` starts it muted. State is mirrored in the URL (`s*` params).
 */
const DEFAULTS = {
  srpm: 0,
  sthr: 0.6,
  sgear: 3,
  sspd: 0,
  sslide: 0,
  ssrf: 'gravel',
  slock: false,
  slis: 'chase',
  stun: false,
  svol: 0.5,
};
const SURFACE_IDS = Object.keys(SURFACES);

export class SoundDebug {
  private readonly st = readUrlState(DEFAULTS);
  private audio?: CarAudio;
  private on = false;
  private pedal = true;
  private hold = false;
  private sweep = 0;
  private impact = 0;
  private sweepT = 0;
  private rpmCtl;
  private info;

  constructor(
    section: PanelSection,
    private car: CarDef,
  ) {
    const st = this.st;
    st.ssrf = paramOneOf(st.ssrf, SURFACE_IDS, DEFAULTS.ssrf);
    st.slis = paramOneOf(st.slis, CAMERA_MODES, DEFAULTS.slis);
    const sync = () => writeUrlState(st, DEFAULTS);
    const e = car.physics.engine;
    if (st.srpm <= 0) st.srpm = e.idleRpm;
    section.checkbox('Sound on (starts on this click)', false, (v) => {
      this.on = v;
      this.ensure();
      this.audio?.setPaused(!v);
    });
    section.slider('Volume', st.svol, { min: 0, max: 1, step: 0.01 }, (v) => {
      st.svol = v;
      this.audio?.setVolume(v);
      sync();
    });
    section.checkbox('Muted', isMutedByUrl(), (v) => {
      this.ensure();
      if (this.audio && this.audio.muted !== v) this.audio.toggleMute();
    });
    this.rpmCtl = section.slider(
      'RPM',
      st.srpm,
      { min: 500, max: 11000, step: 50 },
      (v) => {
        st.srpm = v;
        sync();
      },
    );
    section.checkbox('Pedal down (off = lift-off pops)', true, (v) => {
      this.pedal = v;
    });
    section.slider('Throttle', st.sthr, { min: 0, max: 1, step: 0.01 }, (v) => {
      st.sthr = v;
      sync();
    });
    const gears = car.physics.gearbox.ratios.length;
    section.select(
      'Gear (changing = shift sound)',
      String(st.sgear),
      [
        { value: '0', label: 'N' },
        ...Array.from({ length: gears }, (_, i) => ({
          value: String(i + 1),
          label: String(i + 1),
        })),
      ],
      (v) => {
        st.sgear = Number(v);
        sync();
      },
    );
    section.slider(
      'Speed (m/s: wind, roll, whine)',
      st.sspd,
      { min: 0, max: 60, step: 0.5 },
      (v) => {
        st.sspd = v;
        sync();
      },
    );
    section.slider(
      'Slide (m/s)',
      st.sslide,
      { min: 0, max: 14, step: 0.1 },
      (v) => {
        st.sslide = v;
        sync();
      },
    );
    section.select('Surface', st.ssrf, SURFACE_IDS, (v) => {
      st.ssrf = v;
      sync();
    });
    section.checkbox('Wheels locked (braking)', st.slock, (v) => {
      st.slock = v;
      sync();
    });
    section.select('Listener', st.slis, CAMERA_MODES, (v) => {
      st.slis = v;
      sync();
    });
    section.checkbox('In a tunnel', st.stun, (v) => {
      st.stun = v;
      sync();
    });
    const rev = section.button('Hold to rev', () => {});
    rev.addEventListener('pointerdown', () => (this.hold = true));
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel'])
      rev.addEventListener(ev, () => (this.hold = false));
    section.button('Sweep idle - redline - idle', () => {
      this.sweep = 1;
      this.sweepT = 0;
    });
    section.button('Impact', () => (this.impact = 15000));
    this.info = section.info();
  }

  /** The viewer switched cars: the new car's CarSoundDef. */
  setCar(car: CarDef): void {
    this.car = car;
    if (!this.audio) return;
    this.audio.dispose();
    this.audio = undefined;
    this.ensure();
    const e = car.physics.engine;
    this.st.srpm = Math.min(Math.max(this.st.srpm, e.idleRpm), e.redlineRpm);
    this.rpmCtl.set(this.st.srpm);
  }

  private ensure(): void {
    if (this.audio) return;
    this.audio = new CarAudio(this.car);
    this.audio.setVolume(this.st.svol);
    this.audio.setPaused(!this.on);
  }

  onFrame(dt: number): void {
    const a = this.audio;
    if (!a || !this.on) return;
    const e = this.car.physics.engine;
    const st = this.st;
    let rpm = st.srpm;
    let pedal = this.pedal;
    if (this.sweep) {
      this.sweepT += dt / 3;
      const k = this.sweepT < 1 ? this.sweepT : 2 - this.sweepT;
      rpm = e.idleRpm + (e.redlineRpm - e.idleRpm) * Math.max(0, k);
      pedal = this.sweepT < 1;
      if (this.sweepT >= 2) this.sweep = 0;
    } else if (this.hold) {
      rpm = e.redlineRpm * 0.97;
      pedal = true;
    }
    const surface = st.ssrf as SurfaceId;
    const thr = pedal ? st.sthr : 0;
    const frame: CarSoundFrame = {
      rpm,
      throttle: thr,
      pedal: pedal ? Math.max(thr, 0.2) : 0,
      gear: st.sgear,
      speed: st.sspd,
      wheelHz: st.sspd / (2 * Math.PI * this.car.physics.wheelRadius),
      slide: st.sslide,
      loose: SURFACES[surface].loose,
      impact: this.impact,
      surfaces: { [surface]: 1 },
      lock: st.slock ? 0.5 : 0,
    };
    this.impact = 0;
    a.setListener(st.slis as (typeof CAMERA_MODES)[number]);
    a.update(frame);
    a.setEnclosure(
      st.stun ? { enclosure: 1, wallL: 3, wallR: 3, length: 80 } : undefined,
      st.sspd,
    );
    this.info({
      rpm: Math.round(rpm),
      context: a.state,
    });
  }
}
