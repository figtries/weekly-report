import type { HseRow, NonEffectiveRow, WeatherInfo } from './types';

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

export function defaultNonEffective(): NonEffectiveRow[] {
  return [
    { id: 'ne1', cause: 'Bad Weather', previous: 0, today: 0, remark: '' },
    { id: 'ne2', cause: 'General Safety Meeting', previous: 0, today: 0, remark: '' },
    { id: 'ne3', cause: 'Crew Change Day', previous: 0, today: 0, remark: '' },
    { id: 'ne4', cause: 'Personnel Standby', previous: 0, today: 0, remark: '' },
    { id: 'ne5', cause: 'Fire Drill', previous: 0, today: 0, remark: '' },
  ];
}

export function defaultHse(): HseRow[] {
  return [
    { id: 'hse1', activity: 'Fatality', previous: 0, today: 0 },
    { id: 'hse2', activity: 'Lost Time Incident (LTI)', previous: 0, today: 0 },
    { id: 'hse3', activity: 'Non - Lost Time Incident (NLTI)', previous: 0, today: 0 },
    { id: 'hse4', activity: 'Unsafe Condition / Unsafe Action', previous: 0, today: 0 },
    { id: 'hse5', activity: 'Near Miss', previous: 0, today: 0 },
    { id: 'hse6', activity: 'Medical Treatment', previous: 0, today: 0 },
  ];
}
