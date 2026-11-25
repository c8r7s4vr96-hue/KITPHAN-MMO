import { attachLocketActivationToOrder } from "./locket-auto-worker.js";

export async function onOrderPaymentSuccess(order) {
  const { order: updatedOrder } = await attachLocketActivationToOrder(order);
  return updatedOrder;
}

export { attachLocketActivationToOrder };
