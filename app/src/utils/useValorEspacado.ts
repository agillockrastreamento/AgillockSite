import { useEffect, useRef, useState } from 'react';

/**
 * Devolve `valor` com no máximo uma atualização a cada `intervaloMs`.
 *
 * A primeira mudança passa na hora (não atrasa o carregamento inicial); as
 * seguintes são espaçadas. Serve para telas onde os dados chegam mais rápido do
 * que faz sentido redesenhar — por exemplo a lista de veículos, que não precisa
 * acompanhar cada posição recebida do WebSocket enquanto o usuário rola.
 *
 * `chaveImediata` escapa do espaçamento: sempre que ela muda, o valor atual é
 * publicado na hora. Use para mudanças que o usuário provocou e espera ver
 * refletidas de imediato (trocar de mapa, atualizar a lista), em contraste com
 * as atualizações de fundo.
 */
export function useValorEspacado<T>(
  valor: T,
  intervaloMs: number,
  chaveImediata?: string,
): T {
  const [visivel, setVisivel] = useState(valor);
  const valorRef = useRef(valor);
  valorRef.current = valor;
  const ultimaAplicacaoRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chaveRef = useRef(chaveImediata);

  useEffect(() => {
    if (chaveRef.current !== chaveImediata) {
      chaveRef.current = chaveImediata;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      ultimaAplicacaoRef.current = Date.now();
      setVisivel(valorRef.current);
      return;
    }

    if (visivel === valor) return;

    const restante = intervaloMs - (Date.now() - ultimaAplicacaoRef.current);
    if (restante <= 0) {
      ultimaAplicacaoRef.current = Date.now();
      setVisivel(valor);
      return;
    }

    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      ultimaAplicacaoRef.current = Date.now();
      setVisivel(valorRef.current);
    }, restante);
  }, [valor, visivel, intervaloMs, chaveImediata]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return visivel;
}
