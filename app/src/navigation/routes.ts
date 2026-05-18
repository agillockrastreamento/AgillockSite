export type RootStackParamList = {
  Login: undefined;
  Cliente: undefined;
  Map: { dispositivoId?: string; highlight?: boolean } | undefined;
  Notifications: undefined;
  Payments: undefined;
  Relatorio: undefined;
  Notificacoes: undefined;
  Manutencao: undefined;
  Pagamentos: undefined;
  Historico: { dispositivoId: string; nome: string; placa?: string | null };
  UsuarioForm: { id?: string } | undefined;
};

export type ClienteDrawerParamList = {
  Mapa: undefined;
  Relatorio: undefined;
  Notificacoes: undefined;
  Manutencao: undefined;
  Pagamentos: undefined;
  Usuarios: undefined;
};
