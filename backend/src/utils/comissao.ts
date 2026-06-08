// Utilidades de cálculo de comissão por valor exato.
//
// Regra do negócio: "tudo que for = a X recebe X%". Cada regra associa um valor
// exato de cobrança a um percentual de comissão. Uma cobrança cujo valor não
// corresponda exatamente a nenhuma regra NÃO gera comissão (0%).

export type RegraLike = {
  valor: unknown;
  percentual: unknown;
  ativo?: boolean;
};

/** Converte um valor em reais para centavos inteiros (evita erro de ponto flutuante na comparação). */
export function centavos(valor: number): number {
  return Math.round(Number(valor) * 100);
}

/**
 * Retorna o percentual da regra cujo valor é exatamente igual ao informado,
 * ou null se nenhuma regra corresponder.
 */
export function buscarPercentual(valor: number, regras: RegraLike[]): number | null {
  const alvo = centavos(valor);
  for (const r of regras) {
    if (r.ativo === false) continue;
    if (centavos(Number(r.valor)) === alvo) return Number(r.percentual);
  }
  return null;
}

/**
 * Calcula a comissão de um boleto agrupada por percentual aplicado.
 * Cada valor (individual ou de cada placa/dispositivo unificado) é casado com a
 * tabela de regras; valores sem regra são ignorados.
 *
 * Retorna um Map<percentual, valorComissaoAcumulado>.
 */
export function comissaoPorPercentual(
  valor: number,
  placasUnificadas: Array<{ valorPlaca: unknown }>,
  regras: RegraLike[],
  dispositivosUnificados: Array<{ valorDispositivo: unknown }> = []
): Map<number, number> {
  const out = new Map<number, number>();

  const acumular = (v: number): void => {
    const pct = buscarPercentual(v, regras);
    if (pct === null) return;
    const com = Math.round(v * pct) / 100;
    out.set(pct, (out.get(pct) || 0) + com);
  };

  const totalUnificados = placasUnificadas.length + dispositivosUnificados.length;
  if (totalUnificados > 0) {
    for (const bp of placasUnificadas) acumular(Number(bp.valorPlaca));
    for (const bd of dispositivosUnificados) acumular(Number(bd.valorDispositivo));
  } else {
    acumular(valor);
  }

  return out;
}
