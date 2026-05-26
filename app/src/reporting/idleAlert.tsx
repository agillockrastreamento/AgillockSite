import { useEffect, useRef, useState, type ReactElement } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';

// Tempo (minutos) a partir do qual a ociosidade (motor ligado + parado) vira
// alerta no mapa. Espelha o OCIOSO_LIMITE_MIN do site.
export const IDLE_ALERT_LIMIT_MIN = 5;

// Ícone de alerta âmbar (triângulo com "!"), equivalente ao fa-exclamation-triangle
// usado no site. Renderizado em SVG para ser capturado como PNG.
export function IdleAlertSvg({ size = 30 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 3 L22.5 21 L1.5 21 Z"
        fill="#f0ad4e"
        stroke="#ffffff"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Rect x={11} y={9} width={2} height={6} rx={1} fill="#ffffff" />
      <Circle cx={12} cy={17.6} r={1.2} fill="#ffffff" />
    </Svg>
  );
}

// Os marcadores do react-native-maps não atualizam uma View arbitrária de forma
// confiável (sobretudo no Android), por isso o app captura os ícones como PNG e
// usa `image={{ uri }}` — mesmo padrão do ícone de veículo e do pin de parada.
// Este hook devolve o `bitmap` (uri do PNG) e o `offscreen` (View oculta que
// precisa ser montada para a captura acontecer).
export function useIdleAlertBitmap(): { bitmap: string | null; offscreen: ReactElement } {
  const ref = useRef<View>(null);
  const [bitmap, setBitmap] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!ref.current) return;
      captureRef(ref, { format: 'png', quality: 1, result: 'tmpfile' })
        .then((uri) => setBitmap(uri))
        .catch(() => {});
    }, 150);
    return () => clearTimeout(timer);
  }, []);

  const offscreen = (
    <View
      ref={ref}
      collapsable={false}
      pointerEvents="none"
      style={{ position: 'absolute', left: -9999, top: 0, opacity: 0 }}
    >
      <IdleAlertSvg size={32} />
    </View>
  );

  return { bitmap, offscreen };
}
