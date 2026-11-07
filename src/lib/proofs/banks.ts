export const BANK_LABELS: Record<string, string> = {
  mcx_express: "Multicaixa Express",
  bai: "BAI",
  bfa: "BFA",
  bic: "Banco BIC",
  atlantico: "Banco Atlântico",
  millennium: "Millennium Atlântico",
  sol: "Banco Sol",
  keve: "Banco Keve",
  bpc: "BPC",
  standard: "Standard Bank",
  yetu: "Banco Yetu",
  bci: "BCI",
  bni: "BNI",
  caixa_angola: "Caixa Angola",
  economico: "Banco Económico",
  access: "Access Bank",
  outro: "Outro",
};

export const CHANNEL_LABELS: Record<string, string> = {
  app: "App do banco",
  express: "Multicaixa Express",
  atm: "ATM",
  internet_banking: "Internet banking",
  outro: "Outro",
};

export function bankLabel(code: string | null | undefined) {
  return code ? (BANK_LABELS[code] ?? code) : "Desconhecido";
}
