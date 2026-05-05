import { useId } from 'react';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';

type Props = {
  categoria?: string | null;
  color?: string | null;
  course?: number | null;
  size?: number;
};

type GradientIds = {
  body: string;
  glass: string;
  metal: string;
};

function normalizeColor(value?: string | null) {
  if (!value) return '#2980b9';
  const trimmed = value.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) return trimmed;
  return '#2980b9';
}

function mapCategoria(categoria?: string | null) {
  const value = (categoria ?? '').toLowerCase();
  if (/moto/i.test(value)) return 'moto';
  if (/caminhao|caminhão|truck|bau|baú|tanque|pipa|reboque/i.test(value)) {
    return 'truck';
  }
  if (/van|onibus|ônibus|bus|ambulancia|ambulância/i.test(value)) return 'van';
  if (/trator|escavadeira|retro|maquina|máquina/i.test(value)) return 'machine';
  return 'car';
}

function CarShape({ color, ids }: { color: string; ids: GradientIds }) {
  return (
    <>
      <Ellipse cx="0" cy="4" rx="22" ry="41" fill="#000000" opacity={0.16} />
      <Rect x="-20" y="-24" width="6" height="17" rx="3" fill="#15191f" />
      <Rect x="14" y="-24" width="6" height="17" rx="3" fill="#15191f" />
      <Rect x="-20" y="13" width="6" height="18" rx="3" fill="#15191f" />
      <Rect x="14" y="13" width="6" height="18" rx="3" fill="#15191f" />
      <Path
        d="M-12,-39 Q0,-44 12,-39 Q16,-30 16,-9 L15,23 Q10,35 0,37 Q-10,35 -15,23 L-16,-9 Q-16,-30 -12,-39 Z"
        fill={color}
      />
      <Path
        d="M-12,-39 Q0,-44 12,-39 Q16,-30 16,-9 L15,23 Q10,35 0,37 Q-10,35 -15,23 L-16,-9 Q-16,-30 -12,-39 Z"
        fill={`url(#${ids.body})`}
        opacity={0.55}
      />
      <Path d="M-9,-29 Q0,-34 9,-29 L12,-17 Q0,-20 -12,-17 Z" fill={`url(#${ids.glass})`} />
      <Path d="M-11,8 Q0,4 11,8 L9,24 Q0,27 -9,24 Z" fill={`url(#${ids.glass})`} />
      <Path d="M-15,-13 L-22,-10 L-21,-5 L-15,-7 Z" fill="#1b2026" />
      <Path d="M15,-13 L22,-10 L21,-5 L15,-7 Z" fill="#1b2026" />
      <Path d="M-13,-39 L-6,-41" stroke="#ffffff" strokeWidth="3.2" opacity={0.9} strokeLinecap="round" />
      <Path d="M6,-41 L13,-39" stroke="#ffffff" strokeWidth="3.2" opacity={0.9} strokeLinecap="round" />
      <Rect x="-13" y="32" width="7" height="3" rx="1.5" fill="#e53935" />
      <Rect x="6" y="32" width="7" height="3" rx="1.5" fill="#e53935" />
    </>
  );
}

function TruckShape({ color, ids }: { color: string; ids: GradientIds }) {
  return (
    <>
      <Ellipse cx="0" cy="6" rx="24" ry="43" fill="#000000" opacity={0.16} />
      <Rect x="-22" y="-30" width="8" height="18" rx="3" fill="#11161b" />
      <Rect x="14" y="-30" width="8" height="18" rx="3" fill="#11161b" />
      <Rect x="-22" y="20" width="8" height="20" rx="3" fill="#11161b" />
      <Rect x="14" y="20" width="8" height="20" rx="3" fill="#11161b" />
      <Rect x="-18" y="-40" width="36" height="30" rx="4" fill={color} />
      <Rect x="-18" y="-40" width="36" height="30" rx="4" fill={`url(#${ids.body})`} opacity={0.6} />
      <Path d="M-15,-36 Q0,-40 15,-36 L16,-22 Q0,-20 -16,-22 Z" fill={`url(#${ids.glass})`} />
      <Rect x="-20" y="-10" width="40" height="50" rx="2" fill="#ecf0f1" />
      <Rect x="-20" y="-10" width="40" height="50" rx="2" fill={`url(#${ids.metal})`} opacity={0.45} />
      <Path d="M-16,-2 H16 M-16,10 H16 M-16,22 H16" stroke="#b6c2cf" strokeWidth="1.5" />
      <Rect x="-12" y="-42" width="7" height="4" rx="1" fill="#ffffff" />
      <Rect x="5" y="-42" width="7" height="4" rx="1" fill="#ffffff" />
    </>
  );
}

function VanShape({ color, ids }: { color: string; ids: GradientIds }) {
  return (
    <>
      <Ellipse cx="0" cy="2" rx="22" ry="43" fill="#000000" opacity={0.15} />
      <Rect x="-18" y="-45" width="36" height="88" rx="5" fill={color} />
      <Rect x="-18" y="-45" width="36" height="88" rx="5" fill={`url(#${ids.body})`} opacity={0.5} />
      <Path d="M-16,-39 L16,-39 L16,-25 L-16,-25 Z" fill={`url(#${ids.glass})`} />
      <Rect x="-15" y="-12" width="5" height="34" rx="1" fill={`url(#${ids.glass})`} />
      <Rect x="10" y="-12" width="5" height="34" rx="1" fill={`url(#${ids.glass})`} />
      <Rect x="-22" y="-28" width="5" height="16" rx="2" fill="#11161b" />
      <Rect x="17" y="-28" width="5" height="16" rx="2" fill="#11161b" />
      <Rect x="-22" y="20" width="5" height="16" rx="2" fill="#11161b" />
      <Rect x="17" y="20" width="5" height="16" rx="2" fill="#11161b" />
    </>
  );
}

function MotoShape({ color, ids }: { color: string; ids: GradientIds }) {
  return (
    <>
      <Ellipse cx="0" cy="4" rx="15" ry="40" fill="#000000" opacity={0.16} />
      <Rect x="-4" y="-40" width="8" height="17" rx="4" fill="#11161b" />
      <Rect x="-5" y="24" width="10" height="18" rx="5" fill="#11161b" />
      <Path d="M-11,-27 Q0,-42 11,-27 L15,-9 Q0,-12 -15,-9 Z" fill={color} />
      <Path d="M-11,-27 Q0,-42 11,-27 L15,-9 Q0,-12 -15,-9 Z" fill={`url(#${ids.body})`} opacity={0.76} />
      <Path d="M-6,-27 Q0,-35 6,-27 L7,-18 Q0,-20 -7,-18 Z" fill={`url(#${ids.glass})`} />
      <Path d="M-14,-16 L-5,-11 M14,-16 L5,-11" stroke="#252b31" strokeWidth="3.2" strokeLinecap="round" />
      <Path d="M-10,-10 Q0,-18 10,-10 L8,6 Q0,11 -8,6 Z" fill={color} />
      <Path d="M-5,4 Q0,-3 5,4 L4,18 Q0,22 -4,18 Z" fill="#161b20" />
      <Path d="M-4,18 Q0,13 4,18 L2,34 Q0,38 -2,34 Z" fill={color} />
      <Circle cx="0" cy="-31" r="1.8" fill="#ffffff" />
    </>
  );
}

function MachineShape({ color, ids }: { color: string; ids: GradientIds }) {
  return (
    <>
      <Rect x="-22" y="-30" width="8" height="60" fill="#222222" />
      <Rect x="14" y="-30" width="8" height="60" fill="#222222" />
      <Rect x="-16" y="-20" width="32" height="40" rx="4" fill={color} />
      <Rect x="-16" y="-20" width="32" height="40" rx="4" fill={`url(#${ids.body})`} opacity={0.45} />
      <Rect x="-14" y="-15" width="14" height="20" fill={`url(#${ids.glass})`} />
      <Path d="M4,-15 L10,-15 L10,-45 L4,-45 Z" fill={color} />
      <Path d="M2,-45 L12,-45 L14,-55 L0,-55 Z" fill="#7f8c8d" />
    </>
  );
}

export function VehicleIcon({
  categoria,
  color,
  course,
  size = 52,
}: Props) {
  const normalizedColor = normalizeColor(color);
  const type = mapCategoria(categoria);
  const rotation = Number.isFinite(course ?? NaN) ? course ?? 0 : 0;
  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const ids = {
    body: `bodyGradient${instanceId}`,
    glass: `glassGradient${instanceId}`,
    metal: `metalGradient${instanceId}`,
  };

  return (
    <Svg width={size} height={size} viewBox="-60 -60 120 120">
      <Defs>
        <LinearGradient id={ids.body} x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%" stopColor={normalizedColor} stopOpacity="1" />
          <Stop offset="35%" stopColor="#ffffff" stopOpacity="0.48" />
          <Stop offset="100%" stopColor={normalizedColor} stopOpacity="1" />
        </LinearGradient>
        <LinearGradient id={ids.glass} x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor="#111820" />
          <Stop offset="50%" stopColor="#2c3e50" />
          <Stop offset="100%" stopColor="#111820" />
        </LinearGradient>
        <LinearGradient id={ids.metal} x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%" stopColor="#5a6268" />
          <Stop offset="50%" stopColor="#d5d8dc" />
          <Stop offset="100%" stopColor="#5a6268" />
        </LinearGradient>
      </Defs>
      <G rotation={rotation} origin="0, 0">
        {type === 'truck' ? <TruckShape color={normalizedColor} ids={ids} /> : null}
        {type === 'van' ? <VanShape color={normalizedColor} ids={ids} /> : null}
        {type === 'moto' ? <MotoShape color={normalizedColor} ids={ids} /> : null}
        {type === 'machine' ? <MachineShape color={normalizedColor} ids={ids} /> : null}
        {type === 'car' ? <CarShape color={normalizedColor} ids={ids} /> : null}
      </G>
    </Svg>
  );
}
