type ToastProps = {
  notification: { message: string; type: 'success' | 'error' } | null;
};

export function Toast({ notification }: ToastProps) {
  if (!notification) return null;
  return (
    <div className={`toast toast-${notification.type}`}>
      {notification.message}
    </div>
  );
}
