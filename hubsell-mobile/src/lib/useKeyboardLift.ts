import { useEffect, useState, type RefObject } from "react";
import { Keyboard, Platform, type View } from "react-native";

/**
 * BÀN PHÍM CHE LỚP NỔI BÁM ĐÁY (anh Trung 04/10, máy Android thật): ô nhập tay và hộp
 * kết quả của màn quét là lớp NỔI (absolute bottom 0) nên padding của
 * KeyboardAvoidingView không đẩy được chúng. Tự đo: phần đáy của `rootRef` nằm dưới mép
 * trên bàn phím bao nhiêu thì nâng các lớp nổi lên bấy nhiêu. Đo theo vị trí thật trên
 * màn nên đúng cả khi màn quét nằm trên thanh tab lẫn khi phủ kín.
 *
 * Tách từ ScanScreen 05/11/2026 để màn Quét đóng gói dùng chung. `rootRef` phải gắn vào
 * View có `collapsable={false}` (Android gộp view rỗng → đo ra 0).
 */
export function useKeyboardLift(rootRef: RefObject<View | null>): {
  /** Số px cần nâng lớp nổi lên. 0 khi bàn phím đóng. */
  kbLift: number;
  kbOpen: boolean;
} {
  const [kbLift, setKbLift] = useState(0);
  const [kbOpen, setKbOpen] = useState(false);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, (e) => {
      setKbOpen(true);
      const kbTop = e.endCoordinates.screenY;
      rootRef.current?.measureInWindow((_x, y, _w, h) => {
        setKbLift(Math.max(0, Math.round(y + h - kbTop)));
      });
    });
    const hide = Keyboard.addListener(hideEvt, () => {
      setKbOpen(false);
      setKbLift(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [rootRef]);
  return { kbLift, kbOpen };
}
