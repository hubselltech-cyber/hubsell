/**
 * Kho lưu token: SecureStore (Keychain/Keystore) trên iOS & Android.
 * expo-secure-store KHÔNG có trên web — bản web chỉ là GIẢ LẬP xem giao diện
 * nên rơi về localStorage là chấp nhận được, tuyệt đối không dùng cho production web.
 */
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {}
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {}
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
