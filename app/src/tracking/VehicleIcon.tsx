import { memo, useId } from 'react';
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
  if (/caminhao_bau|bau|baú|caixa|container/i.test(value)) return 'truck_box';
  if (/caminhao|truck|tanque|pipa|reboque/i.test(value)) return 'truck';
  if (/pickup|picape|assistencia/i.test(value)) return 'pickup';
  if (/van|onibus|ônibus|bus|caravana/i.test(value)) return 'bus';
  if (/ambulancia|ambulância/i.test(value)) return 'ambulance';
  if (/trator|escavadeira|retro|maquina|máquina/i.test(value)) return 'machine';
  return 'car';
}

function CarShape({ color, ids }: { color: string; ids: GradientIds }) {
  return (
    <>
      <Ellipse cx="0" cy="4" rx="22" ry="41" fill="#000" opacity={0.16} />
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
      <Path d="M-12,-14 Q0,-17 12,-14 L12,5 Q0,9 -12,5 Z" fill={color} opacity={0.34} />
      <Path d="M-11,8 Q0,4 11,8 L9,24 Q0,27 -9,24 Z" fill={`url(#${ids.glass})`} />
      <Path d="M-15,-13 L-22,-10 L-21,-5 L-15,-7 Z" fill="#1b2026" />
      <Path d="M15,-13 L22,-10 L21,-5 L15,-7 Z" fill="#1b2026" />
      <Path d="M-13,-39 L-6,-41" stroke="#fff" strokeWidth="3.2" opacity={0.9} strokeLinecap="round" />
      <Path d="M6,-41 L13,-39" stroke="#fff" strokeWidth="3.2" opacity={0.9} strokeLinecap="round" />
      <Rect x="-13" y="32" width="7" height="3" rx="1.5" fill="#e53935" opacity={0.95} />
      <Rect x="6" y="32" width="7" height="3" rx="1.5" fill="#e53935" opacity={0.95} />
    </>
  );
}

function PickUpShape({ color, ids }: { color: string; ids: GradientIds }) {
  return (
    <>
      <Ellipse cx="0" cy="6" rx="24" ry="43" fill="#000" opacity={0.17} />
      <Rect x="-22" y="-27" width="8" height="18" rx="3" fill="#12161b" />
      <Rect x="14" y="-27" width="8" height="18" rx="3" fill="#12161b" />
      <Rect x="-22" y="18" width="8" height="20" rx="3" fill="#12161b" />
      <Rect x="14" y="18" width="8" height="20" rx="3" fill="#12161b" />
      <Path d="M-15,-36 Q0,-41 15,-36 L17,-16 L-17,-16 Z" fill={color} />
      <Path d="M-15,-36 Q0,-41 15,-36 L17,-16 L-17,-16 Z" fill={`url(#${ids.body})`} opacity={0.6} />
      <Path d="M-17,-16 L17,-16 L16,8 L-16,8 Z" fill={color} />
      <Path d="M-17,-16 L17,-16 L16,8 L-16,8 Z" fill={`url(#${ids.body})`} opacity={0.6} />
      <Path d="M-14,-16 Q0,-20 14,-16 L15,-6 Q0,-3 -15,-6 Z" fill={`url(#${ids.glass})`} />
      <Path d="M-16,9 L16,9 L15,38 L-15,38 Z" fill={color} />
      <Path d="M-16,9 L16,9 L15,38 L-15,38 Z" fill={`url(#${ids.metal})`} opacity={0.4} />
      <Rect x="-13" y="11" width="26" height="25" rx="2" fill="#161b20" />
    </>
  );
}

function TruckShape({ color, ids }: { color: string; ids: GradientIds }) {
  return (
    <>
      <Rect x="-14" y="-10" width="28" height="48" fill="#2c3e50" />
      <Rect x="-20" y="8" width="6" height="14" rx="2" fill="#111" />
      <Rect x="14" y="8" width="6" height="14" rx="2" fill="#111" />
      <Rect x="-20" y="26" width="6" height="14" rx="2" fill="#111" />
      <Rect x="14" y="26" width="6" height="14" rx="2" fill="#111" />
      <Rect x="-18" y="-40" width="36" height="30" rx="4" fill={color} />
      <Rect x="-18" y="-40" width="36" height="30" rx="4" fill={`url(#${ids.body})`} opacity={0.6} />
      <Path d="M-15,-36 Q0,-40 15,-36 L16,-22 Q0,-20 -16,-22 Z" fill={`url(#${ids.glass})`} />
    </>
  );
}

function TruckBoxShape({ color, ids }: { color: string; ids: GradientIds }) {
  return (
    <>
      <TruckShape color={color} ids={ids} />
      <Rect x="-20" y="-12" width="40" height="52" rx="2" fill="#ecf0f1" />
      <Rect x="-20" y="-12" width="40" height="52" rx="2" fill={`url(#${ids.metal})`} opacity={0.3} />
    </>
  );
}

function BusShape({ color, ids }: { color: string; ids: GradientIds }) {
  return (
    <>
      <Rect x="-18" y="-45" width="36" height="90" rx="4" fill={color} />
      <Rect x="-18" y="-45" width="36" height="90" rx="4" fill={`url(#${ids.body})`} opacity={0.5} />
      <Path d="M-16,-42 L16,-42 L16,-32 L-16,-32 Z" fill={`url(#${ids.glass})`} />
      <Rect x="-16" y="-25" width="4" height="60" fill={`url(#${ids.glass})`} />
      <Rect x="12" y="-25" width="4" height="60" fill={`url(#${ids.glass})`} />
    </>
  );
}

function AmbulanceShape({ color, ids }: { color: string; ids: GradientIds }) {
  return (
    <>
      <BusShape color="#ecf0f1" ids={ids} />
      <Rect x="-4" y="5" width="8" height="20" fill="#e74c3c" />
      <Rect x="-10" y="11" width="20" height="8" fill="#e74c3c" />
      <Rect x="-10" y="-20" width="6" height="3" fill="red" />
      <Rect x="4" y="-20" width="6" height="3" fill="blue" />
    </>
  );
}

function MotoShape({ color, ids }: { color: string; ids: GradientIds }) {
  return (
    <>
      <Ellipse cx="0" cy="4" rx="15" ry="40" fill="#000" opacity="0.16" />
      <Rect x="-4" y="-40" width="8" height="17" rx="4" fill="#11161b" />
      <Rect x="-5" y="24" width="10" height="18" rx="5" fill="#11161b" />
      <Path d="M-11,-27 Q0,-42 11,-27 L15,-9 Q0,-12 -15,-9 Z" fill={color} />
      <Path d="M-11,-27 Q0,-42 11,-27 L15,-9 Q0,-12 -15,-9 Z" fill={`url(#${ids.body})`} opacity={0.76} />
      <Path d="M-6,-27 Q0,-35 6,-27 L7,-18 Q0,-20 -7,-18 Z" fill={`url(#${ids.glass})`} />
      <Path d="M-14,-16 L-5,-11 M14,-16 L5,-11" stroke="#252b31" strokeWidth="3.2" strokeLinecap="round" />
      <Path d="M-10,-10 Q0,-18 10,-10 L8,6 Q0,11 -8,6 Z" fill={color} />
      <Path d="M-5,4 Q0,-3 5,4 L4,18 Q0,22 -4,18 Z" fill="#161b20" />
      <Path d="M-4,18 Q0,13 4,18 L2,34 Q0,38 -2,34 Z" fill={color} />
      <Circle cx="0" cy="-31" r="1.8" fill="#fff" opacity={0.9} />
    </>
  );
}

function MachineShape({ color, ids }: { color: string; ids: GradientIds }) {
  return (
    <>
      <Rect x="-22" y="-30" width="8" height="60" fill="#222" />
      <Rect x="14" y="-30" width="8" height="60" fill="#222" />
      <Rect x="-16" y="-20" width="32" height="40" rx="4" fill={color} />
      <Rect x="-14" y="-15" width="14" height="20" fill={`url(#${ids.glass})`} />
      <Path d="M4,-15 L10,-15 L10,-45 L4,-45 Z" fill="#f39c12" />
      <Path d="M2,-45 L12,-45 L14,-55 L0,-55 Z" fill="#7f8c8d" />
    </>
  );
}

function VehicleIconBase({
  categoria,
  color,
  course,
  size = 62,
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
          <Stop offset="30%" stopColor="#ffffff" stopOpacity="0.5" />
          <Stop offset="100%" stopColor={normalizedColor} stopOpacity="1" />
        </LinearGradient>
        <LinearGradient id={ids.glass} x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor="#111820" stopOpacity="1" />
          <Stop offset="50%" stopColor="#2c3e50" stopOpacity="1" />
          <Stop offset="100%" stopColor="#111820" stopOpacity="1" />
        </LinearGradient>
        <LinearGradient id={ids.metal} x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%" stopColor="#5a6268" stopOpacity="1" />
          <Stop offset="50%" stopColor="#d5d8dc" stopOpacity="1" />
          <Stop offset="100%" stopColor="#5a6268" stopOpacity="1" />
        </LinearGradient>
      </Defs>
      <G rotation={rotation} origin="0, 0">
        {type === 'truck_box' ? <TruckBoxShape color={normalizedColor} ids={ids} /> : null}
        {type === 'truck' ? <TruckShape color={normalizedColor} ids={ids} /> : null}
        {type === 'bus' ? <BusShape color={normalizedColor} ids={ids} /> : null}
        {type === 'pickup' ? <PickUpShape color={normalizedColor} ids={ids} /> : null}
        {type === 'ambulance' ? <AmbulanceShape color={normalizedColor} ids={ids} /> : null}
        {type === 'moto' ? <MotoShape color={normalizedColor} ids={ids} /> : null}
        {type === 'machine' ? <MachineShape color={normalizedColor} ids={ids} /> : null}
        {type === 'car' ? <CarShape color={normalizedColor} ids={ids} /> : null}
      </G>
    </Svg>
  );
}

// O SVG do veículo é caro (dezenas de nós + gradientes). Em listas com centenas
// de veículos ele era remontado a cada re-render da tela; o memo corta isso.
export const VehicleIcon = memo(VehicleIconBase);

