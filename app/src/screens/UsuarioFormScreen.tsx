import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Icon } from 'react-native-paper';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { apiRequest } from '../services/api/apiClient';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';
import { mascararCpfCnpj } from '../utils/cpfCnpj';
import type { RootStackParamList } from '../navigation/routes';

type Dispositivo = {
  id: string;
  nome: string;
  placa: string | null;
  apelidoCliente: string | null;
};

type Usuario = {
  id: string;
  email: string;
  nome: string | null;
  ativo: boolean;
  perfil: string | null;
  cpfCnpj: string | null;
  permissoes: Record<string, Record<string, boolean>>;
  dispositivoIds: string[];
};

type Tela = 'rastreamento' | 'manutencao' | 'relatorio';

const PERMISSOES_POR_TELA: Record<Tela, { label: string; acoes: { key: string; label: string }[] }> = {
  rastreamento: {
    label: 'Mapa (Rastreamento)',
    acoes: [
      { key: 'bloquear', label: 'Bloquear veículo' },
      { key: 'desbloquear', label: 'Desbloquear veículo' },
      { key: 'criarCerca', label: 'Criar/editar/remover cerca' },
      { key: 'verCerca', label: 'Visualizar cercas' },
      { key: 'verEventos', label: 'Ver notificações/eventos' },
      { key: 'marcarManutencaoRecorrenteFeita', label: 'Marcar manutenção recorrente feita' },
      { key: 'marcarRecorrenciaDataFeita', label: 'Marcar recorrência de data feita' },
      { key: 'uploadFoto', label: 'Upload/alterar foto do veículo' },
      { key: 'editarIdentificacao', label: 'Editar identificação' },
    ],
  },
  manutencao: {
    label: 'Manutenção',
    acoes: [
      { key: 'criar', label: 'Criar registros' },
      { key: 'editar', label: 'Editar registros' },
      { key: 'excluir', label: 'Excluir registros' },
      { key: 'criarRecorrencia', label: 'Criar recorrências' },
      { key: 'editarRecorrencia', label: 'Editar/excluir recorrências' },
      { key: 'marcarFeita', label: 'Marcar como feita' },
    ],
  },
  relatorio: {
    label: 'Relatório',
    acoes: [{ key: 'exportar', label: 'Exportar relatórios' }],
  },
};

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'UsuarioForm'>;

function permsVazias(): Record<Tela, Record<string, boolean>> {
  const base: Record<Tela, Record<string, boolean>> = {
    rastreamento: { ver: false },
    manutencao: { ver: false },
    relatorio: { ver: false },
  };
  (Object.keys(PERMISSOES_POR_TELA) as Tela[]).forEach((tela) => {
    PERMISSOES_POR_TELA[tela].acoes.forEach(({ key }) => {
      base[tela][key] = false;
    });
  });
  return base;
}

export function UsuarioFormScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const toast = useToast();
  const editandoId = route.params?.id;
  const modoEdicao = !!editandoId;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [nome, setNome] = useState('');
  const [perfil, setPerfil] = useState('');
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([]);
  const [dispSelecionados, setDispSelecionados] = useState<Set<string>>(new Set());
  const [permissoes, setPermissoes] = useState<Record<Tela, Record<string, boolean>>>(permsVazias);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([
      apiRequest<Dispositivo[]>('/cliente/usuarios-dispositivos'),
      modoEdicao
        ? apiRequest<Usuario>(`/cliente/usuarios/${editandoId}`)
        : Promise.resolve(null),
    ])
      .then(([disps, user]) => {
        if (!mounted) return;
        setDispositivos(disps);
        if (user) {
          setEmail(user.email);
          setNome(user.nome ?? '');
          setPerfil(user.perfil ?? '');
          setCpfCnpj(mascararCpfCnpj(user.cpfCnpj ?? ''));
          setDispSelecionados(new Set(user.dispositivoIds));
          const base = permsVazias();
          (Object.keys(base) as Tela[]).forEach((tela) => {
            const fonte = user.permissoes?.[tela] ?? {};
            Object.keys(base[tela]).forEach((acao) => {
              base[tela][acao] = !!fonte[acao];
            });
          });
          setPermissoes(base);
        }
      })
      .catch((err) => {
        toast.show({
          message: err instanceof Error ? err.message : 'Erro ao carregar dados.',
          type: 'error',
        });
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [editandoId, modoEdicao, toast]);

  const toggleDispositivo = (id: string) => {
    setDispSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePermissao = (tela: Tela, acao: string) => {
    setPermissoes((prev) => {
      const next = { ...prev, [tela]: { ...prev[tela] } };
      next[tela][acao] = !prev[tela][acao];
      // Se desligar "ver", desliga todas as ações
      if (acao === 'ver' && !next[tela][acao]) {
        Object.keys(next[tela]).forEach((k) => {
          next[tela][k] = false;
        });
      }
      return next;
    });
  };

  const marcarTodos = (marcar: boolean) => {
    if (marcar) {
      setDispSelecionados(new Set(dispositivos.map((d) => d.id)));
    } else {
      setDispSelecionados(new Set());
    }
  };

  const salvar = async () => {
    if (!nome.trim()) {
      toast.show({ message: 'Informe o nome.', type: 'error' });
      return;
    }
    if (!email.trim()) {
      toast.show({ message: 'Informe o email.', type: 'error' });
      return;
    }
    if (!modoEdicao && !senha) {
      toast.show({ message: 'Informe a senha.', type: 'error' });
      return;
    }
    if (senha && senha.length < 6) {
      toast.show({ message: 'Senha mínima de 6 caracteres.', type: 'error' });
      return;
    }
    const cpfCnpjDigits = cpfCnpj.replace(/\D/g, '');
    if (cpfCnpjDigits && cpfCnpjDigits.length !== 11 && cpfCnpjDigits.length !== 14) {
      toast.show({ message: 'CPF/CNPJ inválido — informe 11 (CPF) ou 14 (CNPJ) dígitos.', type: 'error' });
      return;
    }
    const payload: Record<string, unknown> = {
      nome: nome.trim(),
      email: email.trim(),
      perfil: perfil.trim() || null,
      cpfCnpj: cpfCnpjDigits || null,
      permissoes,
      dispositivoIds: Array.from(dispSelecionados),
    };
    if (senha) payload.senha = senha;

    setSaving(true);
    try {
      if (modoEdicao) {
        await apiRequest(`/cliente/usuarios/${editandoId}`, {
          method: 'PUT',
          body: payload,
        });
      } else {
        await apiRequest('/cliente/usuarios', {
          method: 'POST',
          body: payload,
        });
      }
      toast.show({ message: 'Usuário salvo.', type: 'success' });
      navigation.goBack();
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : 'Erro ao salvar.',
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const ordemTelas = useMemo<Tela[]>(() => ['rastreamento', 'manutencao', 'relatorio'], []);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.cardTitulo}>Acesso</Text>
          <Text style={styles.label}>Nome *</Text>
          <TextInput
            value={nome}
            onChangeText={setNome}
            style={styles.input}
            maxLength={80}
            autoFocus={!modoEdicao}
            placeholder="Nome do usuário"
            placeholderTextColor={colors.textMuted}
          />
          <Text style={styles.label}>Email *</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            style={styles.input}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="email@exemplo.com"
            placeholderTextColor={colors.textMuted}
          />
          <Text style={styles.label}>
            Senha {modoEdicao ? '(deixe em branco para manter)' : '*'}
          </Text>
          <View style={styles.passwordWrap}>
            <TextInput
              value={senha}
              onChangeText={setSenha}
              style={[styles.input, styles.inputWithIcon]}
              secureTextEntry={!mostrarSenha}
              placeholder={modoEdicao ? '••••••' : 'Mínimo 6 caracteres'}
              placeholderTextColor={colors.textMuted}
            />
            <Pressable
              accessibilityRole="button"
              style={styles.eyeBtn}
              onPress={() => setMostrarSenha((v) => !v)}
            >
              <Icon source={mostrarSenha ? 'eye-off' : 'eye'} size={20} color={colors.textMuted} />
            </Pressable>
          </View>
          <Text style={styles.label}>Perfil</Text>
          <TextInput
            value={perfil}
            onChangeText={setPerfil}
            style={styles.input}
            placeholder="Ex: Locatário, Mecânico, Motorista"
            placeholderTextColor={colors.textMuted}
          />
          <Text style={styles.label}>CPF/CNPJ (opcional)</Text>
          <TextInput
            value={cpfCnpj}
            onChangeText={(text) => setCpfCnpj(mascararCpfCnpj(text))}
            style={styles.input}
            keyboardType="numeric"
            maxLength={18}
            placeholder="000.000.000-00"
            placeholderTextColor={colors.textMuted}
          />
          <Text style={styles.hint}>Se informado, o usuário também poderá entrar com ele no login.</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.cardTitulo}>Veículos com acesso</Text>
            <View style={styles.linkRow}>
              <Pressable onPress={() => marcarTodos(true)}>
                <Text style={styles.link}>Marcar todos</Text>
              </Pressable>
              <Pressable onPress={() => marcarTodos(false)}>
                <Text style={styles.link}>Desmarcar todos</Text>
              </Pressable>
            </View>
          </View>
          {dispositivos.length === 0 ? (
            <Text style={styles.empty}>Nenhum veículo ativo encontrado.</Text>
          ) : (
            dispositivos.map((d) => {
              const nome = d.apelidoCliente || d.nome;
              const sub = d.placa ? ` — ${d.placa}` : '';
              const marcado = dispSelecionados.has(d.id);
              return (
                <Pressable
                  key={d.id}
                  style={styles.permRow}
                  onPress={() => toggleDispositivo(d.id)}
                >
                  {/* Switch é apenas visual; o toque é tratado pelo Pressable da linha
                      (evita toggle duplo no Android). Cores explícitas p/ consistência iOS/Android. */}
                  <View pointerEvents="none">
                    <Switch
                      value={marcado}
                      trackColor={{ false: colors.border, true: colors.primary }}
                      thumbColor="#fff"
                      ios_backgroundColor={colors.border}
                    />
                  </View>
                  <Text style={styles.permLabel}>
                    {nome}
                    {sub}
                  </Text>
                </Pressable>
              );
            })
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitulo}>Permissões por tela</Text>
          {ordemTelas.map((tela) => {
            const grupo = PERMISSOES_POR_TELA[tela];
            const ativa = !!permissoes[tela]?.ver;
            return (
              <View key={tela} style={styles.permGrupo}>
                <Pressable style={styles.permGrupoHeader} onPress={() => togglePermissao(tela, 'ver')}>
                  <View pointerEvents="none">
                    <Switch
                      value={ativa}
                      trackColor={{ false: colors.border, true: colors.primary }}
                      thumbColor="#fff"
                      ios_backgroundColor={colors.border}
                    />
                  </View>
                  <Text style={styles.permGrupoLabel}>{grupo.label}</Text>
                </Pressable>
                {ativa
                  ? grupo.acoes.map(({ key, label }) => (
                      <Pressable
                        key={key}
                        style={styles.permRowChild}
                        onPress={() => togglePermissao(tela, key)}
                      >
                        <View pointerEvents="none">
                          <Switch
                            value={!!permissoes[tela]?.[key]}
                            trackColor={{ false: colors.border, true: colors.primary }}
                            thumbColor="#fff"
                            ios_backgroundColor={colors.border}
                          />
                        </View>
                        <Text style={styles.permLabel}>{label}</Text>
                      </Pressable>
                    ))
                  : null}
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.btnCancelar} onPress={() => navigation.goBack()}>
          <Text style={styles.btnCancelarLabel}>Cancelar</Text>
        </Pressable>
        <Pressable
          style={[styles.btnSalvar, saving && styles.btnSalvarDisabled]}
          onPress={salvar}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={colors.primaryText} />
          ) : (
            <>
              <Icon source="content-save" size={18} color={colors.primaryText} />
              <Text style={styles.btnSalvarLabel}>Salvar</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cardTitulo: {
    fontSize: 13,
    fontWeight: '900',
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  hint: {
    fontSize: 11,
    color: colors.textMuted,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: colors.text,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  inputWithIcon: {
    paddingRight: 44,
  },
  passwordWrap: {
    position: 'relative',
  },
  eyeBtn: {
    position: 'absolute',
    right: spacing.sm,
    top: 0,
    bottom: 0,
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  linkRow: { flexDirection: 'row', gap: spacing.md },
  link: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  empty: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  permRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
  },
  permRowChild: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 4,
    paddingLeft: spacing.lg,
  },
  permLabel: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
  },
  permGrupo: {
    paddingVertical: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  permGrupoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
  },
  permGrupoLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  btnCancelar: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  btnCancelarLabel: {
    color: colors.text,
    fontWeight: '700',
  },
  btnSalvar: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.primary,
  },
  btnSalvarDisabled: { opacity: 0.6 },
  btnSalvarLabel: {
    color: colors.primaryText,
    fontWeight: '800',
    fontSize: 14,
  },
});
