-- O vendedor pode desativar o telefone no checkout. Quem compra sem telefone
-- fica com um lead próprio em cada pedido (o único por conta só se aplica a telefones).
alter table public.leads alter column phone drop not null;
alter table public.orders alter column customer_phone drop not null;
