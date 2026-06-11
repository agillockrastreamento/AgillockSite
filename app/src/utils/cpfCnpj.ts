// Máscara progressiva de CPF (000.000.000-00) ou CNPJ (00.000.000/0000-00)
export function mascararCpfCnpj(valor: string): string {
  let v = valor.replace(/\D/g, '').slice(0, 14);
  if (v.length <= 11) {
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3');
    v = v.replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
  } else {
    v = v.replace(/^(\d{2})(\d)/, '$1.$2');
    v = v.replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3');
    v = v.replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3/$4');
    v = v.replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, '$1.$2.$3/$4-$5');
  }
  return v;
}

// Máscara "inteligente" para campos que aceitam e-mail OU CPF/CNPJ:
// só dígitos (e pontuação da máscara) → aplica máscara; qualquer letra/@ → texto livre.
// `valorAnterior` permite limpar a pontuação inserida pela máscara quando o usuário
// digita a primeira letra de um e-mail que começa com números.
export function mascararLoginIdentificador(valor: string, valorAnterior = ''): string {
  const ehTextoLivre = /[^\d.\-\/\s]/.test(valor);
  if (ehTextoLivre) {
    const anteriorEraMascarado = valorAnterior !== '' && !/[^\d.\-\/\s]/.test(valorAnterior);
    return anteriorEraMascarado ? valor.replace(/[.\-\/\s]/g, '') : valor;
  }
  const digits = valor.replace(/\D/g, '');
  if (!digits) return valor;
  return mascararCpfCnpj(digits);
}
