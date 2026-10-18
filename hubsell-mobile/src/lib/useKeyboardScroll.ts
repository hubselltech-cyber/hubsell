import { useCallback, useEffect, useRef } from "react";
import { Keyboard, Platform, ScrollView, TextInput } from "react-native";

/**
 * CUỘN Ô ĐANG GÕ LÊN TRÊN BÀN PHÍM (1.3.1, anh Trung 19/10: "phải trượt lên
 * cao khi sử dụng bàn phím").
 *
 * KeyboardAvoidingView (behavior="padding") chỉ CO vùng cuộn lại cho bằng phần
 * màn còn trống; React Native 0.86 KHÔNG tự cuộn ô đang nhập vào vùng nhìn
 * thấy (ScrollView có sẵn `scrollResponderScrollNativeHandleToKeyboard` nhưng
 * không chỗ nào gọi tự động) → ô ở nửa dưới màn (Mật khẩu, Nhập lại mật khẩu,
 * ô xóa tài khoản) vẫn bị bàn phím che trên máy nhỏ. Hook này gọi hàm đó:
 *  - khi bàn phím mở (iOS: keyboardWillShow — ScrollView đã nhận metrics bàn
 *    phím trước vì đăng ký listener lúc mount; Android: keyboardDidShow),
 *  - và khi đổi ô nhập lúc bàn phím đang mở (onFocus — sự kiện bàn phím không
 *    bắn lại).
 * `preventNegativeScrollOffset=true`: ô đã nằm trên bàn phím thì không cuộn.
 * Phép đo giả định ScrollView bắt đầu từ mép trên màn (đúng với 3 màn dùng:
 * Đăng nhập, Đăng ký, Tài khoản — đều headerShown false, full màn).
 */
const EXTRA_OFFSET = 96; // chừa chỗ cho nút Đăng nhập / nhãn ngay dưới ô
const FOCUS_DELAY_MS = Platform.OS === "ios" ? 80 : 250;

export function useKeyboardScroll() {
  const scrollRef = useRef<ScrollView>(null);

  const scrollToFocused = useCallback(() => {
    const input = TextInput.State.currentlyFocusedInput();
    const scroll = scrollRef.current;
    if (!input || !scroll) return;
    try {
      scroll.scrollResponderScrollNativeHandleToKeyboard(input, EXTRA_OFFSET, true);
    } catch {
      // Web / ô đã unmount — bỏ qua, không được làm hỏng màn đăng nhập.
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      // Để sang tick sau: trên Android KeyboardAvoidingView cũng nhận
      // keyboardDidShow và đổi padding — cuộn sau khi layout mới ổn định.
      () => setTimeout(scrollToFocused, FOCUS_DELAY_MS)
    );
    return () => sub.remove();
  }, [scrollToFocused]);

  /** Gắn vào onFocus của từng TextInput. */
  const onInputFocus = useCallback(() => {
    if (Platform.OS === "web") return;
    setTimeout(scrollToFocused, FOCUS_DELAY_MS);
  }, [scrollToFocused]);

  return { scrollRef, onInputFocus };
}
