export type Testimonial = {
  name: string;
  text: string;
  rating: number | null;
  photoPath: string | null;
};

export type PaymentInstructions = {
  /** Passos mostrados logo no ecrã de pagamento. */
  bank_app: string[];
  express: string[];
  atm: string[];
  /** Passos que só aparecem passados alguns minutos, junto com o envio do comprovativo. */
  later: string[];
};

export type EmailField = "required" | "optional" | "hidden";
export type InstructionsMode = "shown" | "collapsed" | "hidden";

/** Opções do ecrã de pagamento e do formulário, guardadas em payment_instructions.options. */
export type CheckoutOptions = {
  emailField: EmailField;
  /** Caixa de envio do comprovativo visível desde o início (sem esperar os minutos). */
  proofAlwaysVisible: boolean;
  /** Instruções de como pagar: visíveis, minimizadas (abrem ao tocar) ou escondidas. */
  instructionsMode: InstructionsMode;
};

export type CheckoutConfig = CheckoutOptions & {
  logoPath: string | null;
  bannerPath: string | null;
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  title: string | null;
  description: string | null;
  testimonials: Testimonial[];
  guaranteeText: string | null;
  timerEnabled: boolean;
  timerMinutes: number | null;
  buttonText: string;
  paymentInstructions: PaymentInstructions;
};

export type CheckoutPageRow = {
  product_id: string;
  logo_path: string | null;
  banner_path: string | null;
  primary_color: string;
  accent_color: string;
  background_color: string;
  title: string | null;
  description: string | null;
  testimonials: Testimonial[] | null;
  guarantee_text: string | null;
  timer_enabled: boolean;
  timer_minutes: number | null;
  button_text: string;
  payment_instructions: (Partial<PaymentInstructions> & { options?: Partial<CheckoutOptions> }) | null;
  updated_at: string;
};
