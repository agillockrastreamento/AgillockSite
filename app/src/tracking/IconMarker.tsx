import React, { useEffect, useState } from 'react';
import { Marker } from 'react-native-maps';
import type { MapMarkerProps } from 'react-native-maps';

type Props = MapMarkerProps & {
  /**
   * Assinatura do conteúdo visual do marcador (cor, curso, label, etc.).
   * Sempre que muda, o marcador é re-snapshotado para refletir o novo ícone.
   */
  signature: string;
  children: React.ReactNode;
};

/**
 * Marcador com ícone customizado (filho) que se atualiza no iOS sem remontar.
 *
 * No iOS/Fabric (New Architecture) NÃO podemos, em runtime:
 *  - trocar a `key` do <Marker> (remontar derruba o app — crash nativo);
 *  - confiar no prop `image` reaplicar (ele NÃO atualiza in-place: cor/curso/
 *    label só mudavam ao desfocar, quando o marcador remontava por outro motivo);
 *  - rodar captureRef em rajada ou trocar `image` em alta frequência (crash).
 *
 * A forma nativa e segura é renderizar o ícone como FILHO do <Marker> e pedir
 * ao mapa para re-snapshotar a view via `tracksViewChanges`. Como mantê-lo
 * sempre ligado é caro com muitos marcadores, ligamos apenas por uma janela
 * curta sempre que a `signature` muda. A `key` permanece estável.
 */
export function IconMarker({ signature, children, ...rest }: Props) {
  const [tracks, setTracks] = useState(true);

  useEffect(() => {
    setTracks(true);
    const timer = setTimeout(() => setTracks(false), 500);
    return () => clearTimeout(timer);
  }, [signature]);

  return (
    <Marker {...rest} tracksViewChanges={tracks}>
      {children}
    </Marker>
  );
}
