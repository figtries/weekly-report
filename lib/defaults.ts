import type { WeatherInfo } from './types';

/**
 * The delay-cause, HSE and crew lists that used to live here moved to
 * `lib/catalogs.ts` as per-project data — they were PT Indoturbine's own
 * categories compiled into the app, which is why no second company could use
 * it without a code change.
 *
 * Weather stays here because `WeatherInfo` is a fixed-shape record rather than
 * a list: the four conditions are named fields, so making them configurable
 * means changing the type and the daily form together. Weather is also the
 * least project-specific of the four, so it is the right one to leave until
 * the rest has settled.
 */
export function defaultWeather(): WeatherInfo {
  return {
    hujanDeras: false,
    hujanDerasJam: '',
    hujanSedang: false,
    hujanSedangJam: '',
    berawanMendung: false,
    berawanMendungJam: '',
    cerahTerang: false,
    cerahTerangJam: '',
    waktuMulai: '06:00',
    waktuSelesai: '18:00',
  };
}
