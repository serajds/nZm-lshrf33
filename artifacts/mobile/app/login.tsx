import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  I18nManager,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { ApiError } from "@/lib/api";

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = phone.trim().length > 0 && password.length > 0 && !loading;

  async function onSubmit() {
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    try {
      await login(phone, password);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/");
    } catch (e) {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (e instanceof ApiError) {
        if (e.code === "ACCOUNT_NOT_ACTIVATED") {
          router.replace("/pending-assignment");
          return;
        } else {
          setError(e.message || "فشل تسجيل الدخول");
        }
      } else {
        setError("فشل تسجيل الدخول. حاول مجددًا.");
      }
    } finally {
      setLoading(false);
    }
  }

  const writingDirection = "rtl" as const;

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + 24 }]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.brandWrap}>
          <View style={[styles.logoCircle, { backgroundColor: colors.primary }]}>
            <Feather name="shield" size={36} color={colors.primaryForeground} />
          </View>
          <Text style={[styles.brandTitle, { color: colors.foreground }]}>إدارة الإشراف والمتابعة</Text>
          <Text style={[styles.brandSub, { color: colors.mutedForeground }]}>تسجيل الحضور — نسخة الموبايل</Text>
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border, borderRadius: 16 },
          ]}
        >
          <Text style={[styles.label, { color: colors.foreground, writingDirection }]}>رقم الهاتف</Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="مثال: 0911234567"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="phone-pad"
            autoCapitalize="none"
            autoCorrect={false}
            textAlign={I18nManager.isRTL ? "right" : "left"}
            style={[
              styles.input,
              {
                color: colors.foreground,
                borderColor: colors.input,
                backgroundColor: colors.background,
              },
            ]}
            testID="login-phone"
          />

          <Text style={[styles.label, { color: colors.foreground, marginTop: 16, writingDirection }]}>كلمة المرور</Text>
          <View style={{ position: "relative" }}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="••••••"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              textAlign={I18nManager.isRTL ? "right" : "left"}
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  borderColor: colors.input,
                  backgroundColor: colors.background,
                  paddingLeft: 44,
                },
              ]}
              testID="login-password"
            />
            <TouchableOpacity
              onPress={() => setShowPassword((v) => !v)}
              style={styles.eyeBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Feather name={showPassword ? "eye-off" : "eye"} size={20} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          {error ? (
            <View
              style={[
                styles.errorBox,
                { backgroundColor: "#fee2e2", borderColor: "#fecaca" },
              ]}
            >
              <Feather name="alert-circle" size={16} color={colors.destructive} />
              <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            onPress={onSubmit}
            disabled={!canSubmit}
            activeOpacity={0.85}
            style={[
              styles.submit,
              {
                backgroundColor: canSubmit ? colors.primary : colors.muted,
                borderRadius: 12,
              },
            ]}
            testID="login-submit"
          >
            {loading ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.submitText, { color: canSubmit ? colors.primaryForeground : colors.mutedForeground }]}>
                تسجيل الدخول
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={[styles.helpText, { color: colors.mutedForeground }]}>
          إذا لم يكن لديك حساب، تواصل مع مسؤول النظام لإنشائه وتفعيله.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 20, paddingBottom: 40 },
  brandWrap: { alignItems: "center", marginBottom: 28, marginTop: 16 },
  logoCircle: {
    width: 84, height: 84, borderRadius: 42,
    alignItems: "center", justifyContent: "center",
    marginBottom: 14,
    shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  brandTitle: { fontSize: 22, fontFamily: "Cairo_700Bold", textAlign: "center" },
  brandSub: { fontSize: 14, fontFamily: "Cairo_400Regular", marginTop: 4 },
  card: { padding: 20, borderWidth: 1 },
  label: { fontSize: 14, fontFamily: "Cairo_600SemiBold", marginBottom: 8 },
  input: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, fontFamily: "Cairo_400Regular",
  },
  eyeBtn: { position: "absolute", left: 10, top: 0, bottom: 0, justifyContent: "center", paddingHorizontal: 4 },
  errorBox: {
    marginTop: 14, padding: 10, borderRadius: 10, borderWidth: 1,
    flexDirection: "row", alignItems: "center", gap: 8,
  },
  errorText: { flex: 1, fontFamily: "Cairo_400Regular", fontSize: 13 },
  submit: {
    marginTop: 22, paddingVertical: 14, alignItems: "center", justifyContent: "center", minHeight: 50,
  },
  submitText: { fontSize: 16, fontFamily: "Cairo_700Bold" },
  helpText: { textAlign: "center", marginTop: 22, fontSize: 13, fontFamily: "Cairo_400Regular", paddingHorizontal: 12 },
});
