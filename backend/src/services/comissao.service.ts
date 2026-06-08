import prisma from '../utils/prisma';
import { buscarPercentual, RegraLike } from '../utils/comissao';

/**
 * Calcula e registra comissões para um boleto recém-pago.
 *
 * Regra: cada placa tem um vendedor "dono" (o primeiro que gerou cobrança para ela).
 * - Boleto individual: 1 comissão para o vendedor dono da placa
 * - Boleto unificado: 1 comissão por placa, cada uma para o vendedor dono daquela placa
 *   (um boleto unificado pode gerar comissões para múltiplos vendedores)
 *
 * Comissão por valor exato: o percentual aplicado vem da tabela RegraComissao
 * ("tudo que for = a X recebe X%"). Valores sem regra correspondente NÃO geram
 * comissão (0%).
 */
export async function registrarComissoes(boletoId: string): Promise<void> {
  const [boleto, regras] = await Promise.all([
    prisma.boleto.findUnique({
      where: { id: boletoId },
      include: {
        placa: { select: { vendedorId: true } },
        dispositivo: { select: { vendedorId: true } },
        placasUnificadas: {
          include: { placa: { select: { vendedorId: true } } },
        },
        dispositivosUnificados: {
          include: { dispositivo: { select: { vendedorId: true } } },
        },
      },
    }),
    prisma.regraComissao.findMany({ where: { ativo: true } }),
  ]);

  if (!boleto) {
    console.log(`[comissao] boletoId=${boletoId} — boleto não encontrado, abortando.`);
    return;
  }

  const regrasLike: RegraLike[] = regras;

  type ComissaoData = {
    vendedorId: string;
    boletoId: string;
    valorReferencia: number;
    percentualAplicado: number;
    valorComissao: number;
  };

  const comissoes: ComissaoData[] = [];

  // Monta uma comissão para um único valor, buscando o percentual na tabela de regras.
  // Se não houver regra para o valor exato, não gera comissão.
  const montar = (vendedorId: string, valorRef: number, label: string): void => {
    const percentual = buscarPercentual(valorRef, regrasLike);
    if (percentual === null) {
      console.log(`[comissao]   ${label} valor=${valorRef.toFixed(2)} — sem regra correspondente, sem comissão`);
      return;
    }
    comissoes.push({
      vendedorId,
      boletoId,
      valorReferencia: valorRef,
      percentualAplicado: percentual,
      valorComissao: Math.round(valorRef * percentual) / 100,
    });
  };

  const totalUnificados = boleto.placasUnificadas.length + boleto.dispositivosUnificados.length;

  if (totalUnificados > 0) {
    // Boleto unificado: comissão por placa/dispositivo, para o vendedor dono de cada um
    console.log(`[comissao] boletoId=${boletoId} tipo=UNIFICADO placas=${boleto.placasUnificadas.length} dispositivos=${boleto.dispositivosUnificados.length}`);
    for (const bp of boleto.placasUnificadas) {
      const vendedorIdPlaca = bp.placa?.vendedorId;
      console.log(`[comissao]   placaId=${bp.placaId} vendedorId=${vendedorIdPlaca ?? 'null'}`);
      if (!vendedorIdPlaca) continue;
      montar(vendedorIdPlaca, Number(bp.valorPlaca), `placaId=${bp.placaId}`);
    }
    for (const bd of boleto.dispositivosUnificados) {
      const vendedorIdDisp = bd.dispositivo?.vendedorId;
      console.log(`[comissao]   dispositivoId=${bd.dispositivoId} vendedorId=${vendedorIdDisp ?? 'null'}`);
      if (!vendedorIdDisp) continue;
      montar(vendedorIdDisp, Number(bd.valorDispositivo), `dispositivoId=${bd.dispositivoId}`);
    }
  } else {
    // Boleto individual: comissão para o vendedor dono da placa ou do dispositivo
    const vendedorIdPlaca = boleto.placa?.vendedorId;
    const vendedorIdDisp  = boleto.dispositivo?.vendedorId;
    const vendedorEfetivo = vendedorIdPlaca || vendedorIdDisp;
    console.log(`[comissao] boletoId=${boletoId} tipo=INDIVIDUAL placaId=${boleto.placaId ?? 'null'} dispositivoId=${boleto.dispositivoId ?? 'null'} vendedorId=${vendedorEfetivo ?? 'null'}`);
    if (!vendedorEfetivo) {
      console.log(`[comissao] sem vendedorId — sem comissão`);
      return;
    }
    montar(vendedorEfetivo, Number(boleto.valor), 'individual');
  }

  if (comissoes.length > 0) {
    console.log(`[comissao] criando ${comissoes.length} comissão(ões):`, comissoes.map(c => `vendedor=${c.vendedorId} valor=${c.valorComissao}`));
    await prisma.comissaoVendedor.createMany({ data: comissoes });
  } else {
    console.log(`[comissao] nenhuma comissão gerada para boletoId=${boletoId}`);
  }
}
