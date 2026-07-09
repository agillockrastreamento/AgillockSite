import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Icon } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import {
  buscarDispositivo,
  listarDispositivos,
  salvarDispositivo,
  type DispositivoPayload,
  type ImageAsset,
} from '../services/api/dispositivosService';
import { resolveUploadUrl } from '../profile/profileService';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';
import type { RootStackParamList } from '../navigation/routes';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'DispositivoForm'>;

/** Campos livres do formulário. Espelha os cards da tela web (sem mapa/IAPRO/tag BLE/configurações). */
type Campos = {
  nome: string;
  identificador: string;
  categoria: string;
  grupo: string;
  contato: string;
  modeloRastreador: string;
  telefoneRastreador: string;
  iccid: string;
  operadora: string;
  placa: string;
  marca: string;
  modeloVeiculo: string;
  cor: string;
  ano: string;
  renavam: string;
  chassi: string;
  combustivel: string;
  localInstalacao: string;
  instalador: string;
  odometro: string;
};

const CAMPOS_VAZIOS: Campos = {
  nome: '', identificador: '', categoria: '', grupo: '', contato: '',
  modeloRastreador: '', telefoneRastreador: '', iccid: '', operadora: '',
  placa: '', marca: '', modeloVeiculo: '', cor: '', ano: '', renavam: '',
  chassi: '', combustivel: '', localInstalacao: '', instalador: '', odometro: '',
};

export function DispositivoFormScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const toast = useToast();
  const editandoId = route.params?.id;
  const modoEdicao = !!editandoId;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bloqueado, setBloqueado] = useState(false); // cota cheia (só na criação)
  const [campos, setCampos] = useState<Campos>(CAMPOS_VAZIOS);
  const [ativo, setAtivo] = useState(true);
  const [manutencaoAtiva, setManutencaoAtiva] = useState(true);
  const [imagem, setImagem] = useState<ImageAsset | null>(null);
  const [imagemAtualUrl, setImagemAtualUrl] = useState<string | null>(null);

  // Dispositivos associados pela AgilLock: identificação e veículo editáveis,
  // campos do rastreador e status somente leitura.
  const [podeGerenciar, setPodeGerenciar] = useState(true);
  const [podeEditarOdometro, setPodeEditarOdometro] = useState(true);

  const set = (chave: keyof Campos) => (valor: string) =>
    setCampos((prev) => ({ ...prev, [chave]: valor }));

  useEffect(() => {
    let mounted = true;
    setLoading(true);

    const carga = modoEdicao
      ? buscarDispositivo(editandoId!).then((d) => {
          if (!mounted) return;
          setPodeGerenciar(d.podeGerenciar !== false);
          setPodeEditarOdometro(d.podeEditarOdometro !== false);
          setAtivo(d.ativo);
          setManutencaoAtiva(d.manutencaoAtiva);
          setImagemAtualUrl(d.imagemUrl);
          setCampos({
            nome: d.nome ?? '',
            identificador: d.identificador ?? '',
            categoria: d.categoria ?? '',
            grupo: d.grupo ?? '',
            contato: d.contato ?? '',
            modeloRastreador: d.modeloRastreador ?? '',
            telefoneRastreador: d.telefoneRastreador ?? '',
            iccid: d.iccid ?? '',
            operadora: d.operadora ?? '',
            placa: d.placa ?? '',
            marca: d.marca ?? '',
            modeloVeiculo: d.modeloVeiculo ?? '',
            cor: d.cor ?? '',
            ano: d.ano ?? '',
            renavam: d.renavam ?? '',
            chassi: d.chassi ?? '',
            combustivel: d.combustivel ?? '',
            localInstalacao: d.localInstalacao ?? '',
            instalador: d.instalador ?? '',
            odometro: d.odometro != null ? String(Math.round(d.odometro)) : '',
          });
        })
      : listarDispositivos().then((data) => {
          if (!mounted) return;
          if (!data.podeCriar) {
            setBloqueado(true);
            toast.show({
              message: `Você atingiu o limite de ${data.limite} dispositivo(s) do seu plano. Entre em contato com a AgilLock para ampliá-lo.`,
              type: 'error',
            });
          }
        });

    carga
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

  async function escolherImagem() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.84,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setImagem({ uri: asset.uri, fileName: asset.fileName, mimeType: asset.mimeType });
  }

  async function salvar() {
    if (!campos.nome.trim()) {
      toast.show({ message: 'Informe o nome.', type: 'error' });
      return;
    }
    if (!campos.identificador.trim()) {
      toast.show({ message: 'Informe o identificador.', type: 'error' });
      return;
    }

    const payload: DispositivoPayload = {
      nome: campos.nome.trim(),
      categoria: campos.categoria.trim(),
      grupo: campos.grupo.trim(),
      contato: campos.contato.trim(),
      placa: campos.placa.trim().toUpperCase(),
      marca: campos.marca.trim(),
      modeloVeiculo: campos.modeloVeiculo.trim(),
      cor: campos.cor.trim(),
      ano: campos.ano.trim(),
      renavam: campos.renavam.trim(),
      chassi: campos.chassi.trim(),
      combustivel: campos.combustivel.trim(),
      localInstalacao: campos.localInstalacao.trim(),
      instalador: campos.instalador.trim(),
      manutencaoAtiva: manutencaoAtiva ? 'true' : 'false',
    };
    if (podeEditarOdometro) payload.odometro = campos.odometro.trim();
    // Campos da AgilLock: só enviados quando o dispositivo é do próprio cliente
    if (podeGerenciar) {
      payload.identificador = campos.identificador.trim();
      payload.ativo = ativo ? 'true' : 'false';
      payload.modeloRastreador = campos.modeloRastreador.trim();
      payload.telefoneRastreador = campos.telefoneRastreador.trim();
      payload.iccid = campos.iccid.trim();
      payload.operadora = campos.operadora.trim();
    }

    setSaving(true);
    try {
      await salvarDispositivo(payload, imagem, editandoId);
      toast.show({ message: 'Dispositivo salvo.', type: 'success' });
      navigation.goBack();
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : 'Erro ao salvar.',
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const campoRastreador = (rotulo: string, chave: keyof Campos, placeholder: string, teclado?: 'default' | 'phone-pad' | 'numeric') => (
    <>
      <Text style={styles.label}>{rotulo}</Text>
      <TextInput
        value={campos[chave]}
        onChangeText={set(chave)}
        editable={podeGerenciar}
        style={[styles.input, !podeGerenciar && styles.inputDisabled]}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={teclado ?? 'default'}
      />
    </>
  );

  const campoLivre = (rotulo: string, chave: keyof Campos, placeholder: string, extras?: { maxLength?: number; autoCapitalize?: 'none' | 'characters'; keyboardType?: 'default' | 'numeric' | 'phone-pad' }) => (
    <>
      <Text style={styles.label}>{rotulo}</Text>
      <TextInput
        value={campos[chave]}
        onChangeText={set(chave)}
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        maxLength={extras?.maxLength}
        autoCapitalize={extras?.autoCapitalize}
        keyboardType={extras?.keyboardType ?? 'default'}
      />
    </>
  );

  const previewUri = imagem?.uri ?? resolveUploadUrl(imagemAtualUrl);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {!podeGerenciar ? (
          <View style={styles.avisoBloqueio}>
            <Icon source="lock-outline" size={16} color={colors.textMuted} />
            <Text style={styles.avisoTexto}>
              Este dispositivo foi cadastrado pela AgilLock. Você pode atualizar a identificação
              e os dados do veículo, mas os campos do rastreador, o status e a exclusão ficam sob
              responsabilidade da AgilLock.
            </Text>
          </View>
        ) : null}

        {/* Identificação */}
        <View style={styles.card}>
          <Text style={styles.cardTitulo}>Identificação</Text>
          {campoLivre('Nome *', 'nome', 'Ex.: Caminhão Frota 01')}

          <Text style={styles.label}>Identificador *</Text>
          <TextInput
            value={campos.identificador}
            onChangeText={set('identificador')}
            editable={podeGerenciar}
            style={[styles.input, !podeGerenciar && styles.inputDisabled]}
            placeholder="Ex.: DISP-001"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
          />

          {campoLivre('Categoria', 'categoria', 'Ex.: carro, caminhao, motocicleta', { autoCapitalize: 'none' })}
          {campoLivre('Grupo', 'grupo', 'Ex.: Frota SP')}
          {campoLivre('Contato', 'contato', 'Ex.: (11) 9 9999-9999', { keyboardType: 'phone-pad', maxLength: 15 })}

          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>{ativo ? 'Ativo' : 'Inativo'}</Text>
            <Switch
              value={ativo}
              onValueChange={setAtivo}
              disabled={!podeGerenciar}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>
        </View>

        {/* Rastreador */}
        <View style={styles.card}>
          <Text style={styles.cardTitulo}>Rastreador</Text>
          {campoRastreador('Modelo', 'modeloRastreador', 'Ex.: Suntech ST4310')}
          {campoRastreador('Telefone', 'telefoneRastreador', 'Ex.: (11) 9 9999-9999', 'phone-pad')}
          {campoRastreador('ICCID', 'iccid', 'Número do chip')}
          {campoRastreador('Operadora do Chip', 'operadora', 'Ex.: Claro, Vivo, TIM...')}
        </View>

        {/* Veículo */}
        <View style={styles.card}>
          <Text style={styles.cardTitulo}>Veículo</Text>
          {campoLivre('Placa', 'placa', 'ABC1234', { autoCapitalize: 'characters', maxLength: 8 })}
          {campoLivre('Marca', 'marca', 'Ex.: Volkswagen')}
          {campoLivre('Modelo do Veículo', 'modeloVeiculo', 'Ex.: Constellation')}
          {campoLivre('Cor', 'cor', 'Ex.: Branco')}
          {campoLivre('Ano', 'ano', '2024', { keyboardType: 'numeric', maxLength: 4 })}
          {campoLivre('RENAVAM', 'renavam', '00000000000', { keyboardType: 'numeric', maxLength: 11 })}
          {campoLivre('Chassi', 'chassi', '9BWZZZ377VT004251', { autoCapitalize: 'characters', maxLength: 17 })}
          {campoLivre('Combustível', 'combustivel', 'Ex.: Diesel')}
          {campoLivre('Local de Instalação', 'localInstalacao', 'Ex.: Painel dianteiro')}
          {campoLivre('Instalador', 'instalador', 'Nome do instalador')}

          <Text style={styles.label}>Odômetro Atual (km)</Text>
          <TextInput
            value={campos.odometro}
            onChangeText={set('odometro')}
            editable={podeEditarOdometro}
            style={[styles.input, !podeEditarOdometro && styles.inputDisabled]}
            placeholder="Ex.: 125430"
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
          />
        </View>

        {/* Manutenção */}
        <View style={styles.card}>
          <Text style={styles.cardTitulo}>Manutenção</Text>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>
              {manutencaoAtiva ? 'Manutenções ativas' : 'Manutenções desativadas'}
            </Text>
            <Switch
              value={manutencaoAtiva}
              onValueChange={setManutencaoAtiva}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>
          <Text style={styles.ajuda}>
            Ao desativar, todas as recorrências programadas deste dispositivo são canceladas.
          </Text>
        </View>

        {/* Imagem */}
        <View style={styles.card}>
          <Text style={styles.cardTitulo}>Imagem</Text>
          <Pressable style={styles.imgDrop} onPress={escolherImagem}>
            {previewUri ? (
              <>
                <Image source={{ uri: previewUri }} style={styles.imgPreview} resizeMode="cover" />
                <Text style={styles.imgTrocar}>Toque para trocar</Text>
              </>
            ) : (
              <>
                <Icon source="cloud-upload-outline" size={30} color={colors.textMuted} />
                <Text style={styles.imgTexto}>Toque para selecionar uma imagem</Text>
              </>
            )}
          </Pressable>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.btnCancelar} onPress={() => navigation.goBack()}>
          <Text style={styles.btnCancelarLabel}>Cancelar</Text>
        </Pressable>
        <Pressable
          style={[styles.btnSalvar, (saving || bloqueado) && styles.btnSalvarDisabled]}
          disabled={saving || bloqueado}
          onPress={salvar}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.primaryText} />
          ) : (
            <Icon source="content-save" size={18} color={colors.primaryText} />
          )}
          <Text style={styles.btnSalvarLabel}>Salvar Dispositivo</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.lg, gap: spacing.md },
  avisoBloqueio: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  avisoTexto: { flex: 1, fontSize: 12, color: colors.textMuted, lineHeight: 17 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cardTitulo: {
    fontSize: 14,
    fontWeight: '900',
    color: colors.primary,
    marginBottom: spacing.sm,
  },
  label: {
    marginTop: spacing.sm,
    marginBottom: 4,
    fontSize: 12,
    fontWeight: '700',
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
  inputDisabled: { backgroundColor: colors.surfaceMuted, color: colors.textMuted },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  switchLabel: { fontSize: 13, fontWeight: '700', color: colors.text },
  ajuda: { marginTop: spacing.sm, fontSize: 12, color: colors.textMuted, lineHeight: 17 },
  imgDrop: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  imgTexto: { fontSize: 12, color: colors.textMuted },
  imgTrocar: { marginTop: spacing.xs, fontSize: 12, color: colors.primary, fontWeight: '700' },
  imgPreview: { width: '100%', height: 140, borderRadius: radius.md },
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
  btnCancelarLabel: { color: colors.text, fontWeight: '700' },
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
  btnSalvarLabel: { color: colors.primaryText, fontWeight: '800', fontSize: 14 },
});
