import { attachLocketActivationToOrder } from "./locket-auto-worker.js";

/**
 * Gọi hàm này ngay sau khi đơn hàng đã được xác nhận thanh toán thành công.
 * Ví dụ: const updatedOrder = await onOrderPaymentSuccess(order);
 */
export async function onOrderPaymentSuccess(order) {
  const { order: updatedOrder } = await attachLocketActivationToOrder(order);
  return updatedOrder;
}

export { attachLocketActivationToOrder };
