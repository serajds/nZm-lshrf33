import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { useColors } from "@/hooks/useColors";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { apiRequest, queryClient } from "@/lib/query-client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SessionUser } from "@/lib/session";

interface Project {
  id: number;
  name: string;
  location: string;
  status?: "active" | "completed" | "delayed" | "suspended";
  contractorCompanyId?: number | null;
  siteLatitude: number | null;
  siteLongitude: number | null;
  siteRadiusMeters: number | null;
}

interface AttendanceRecord {
  id: number;
  projectId: number;
  type: "check_in" | "check_out";
  recordedAt: string;
  outOfRange: boolean;
}

interface MyAttendanceStatus {
  projectId: number;
  projectName: string;
  hasSiteLocation: boolean;
  siteLatitude: number | null;
  siteLongitude: number | null;
  siteRadiusMeters: number | null;
  currentlyCheckedIn: boolean;
  lastRecord: AttendanceRecord | null;
}

type AttendanceType = "check_in" | "check_out";

function appInsets(top: number, bottom: number) {
  return Platform.OS === "web"
    ? { paddingTop: 67, paddingBottom: Math.max(34, bottom) }
    : { paddingTop: top, paddingBottom: bottom };
}

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-LY", {
    timeZone: "Africa/Tripoli",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function makeClientId(): string {
  const hex = (length: number) => Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${["8", "9", "a", "b"][Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
}

function confirmAction(title: string, message: string): Promise<boolean> {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise(resolve => {
    Alert.alert(title, message, [
      { text: "إلغاء", style: "cancel", onPress: () => resolve(false) },
      { text: "متابعة", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

function openDeviceSettings(): void {
  if (Platform.OS !== "web") {
    void Linking.openSettings().catch(() => {
      Alert.alert("تعذّر فتح الإعدادات", "افتح إعدادات الجهاز واسمح للتطبيق باستخدام الكاميرا والموقع.");
    });
  }
}

async function captureSelfie(): Promise<string | null> {
  let permission = await ImagePicker.getCameraPermissionsAsync();
  if (!permission.granted) {
    const approved = await confirmAction(
      "إذن الكاميرا",
      "نحتاج إلى الكاميرا الأمامية لالتقاط صورة تثبت تسجيل الحضور أو الانصراف. لن تُرسل الصورة إلا مع طلب التسجيل.",
    );
    if (!approved) return null;
    permission = await ImagePicker.requestCameraPermissionsAsync();
  }

  if (!permission.granted) {
    if (!permission.canAskAgain) {
      Alert.alert(
        "إذن الكاميرا مطلوب",
        "فعّل الكاميرا من إعدادات الجهاز للمتابعة.",
        [
          { text: "إلغاء", style: "cancel" },
          { text: "فتح الإعدادات", onPress: openDeviceSettings },
        ],
      );
    } else {
      Alert.alert("لم يُسمح بالكاميرا", "اسمح باستخدام الكاميرا لالتقاط صورة الموقع.");
    }
    return null;
  }

  const result = await ImagePicker.launchCameraAsync({
    cameraType: ImagePicker.CameraType.front,
    mediaTypes: ["images"],
    allowsEditing: false,
    quality: 0.85,
  });
  if (result.canceled || !result.assets[0]?.uri) return null;

  const compressed = await ImageManipulator.manipulateAsync(
    result.assets[0].uri,
    [{ resize: { width: 800 } }],
    { compress: 0.78, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  if (!compressed.base64) throw new Error("تعذّر تجهيز صورة السيلفي. التقط صورة جديدة.");
  return compressed.base64;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("انتهت مهلة تحديد الموقع. انتقل إلى مكان مفتوح ثم أعد المحاولة.")), timeoutMs);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function getDeviceLocation(): Promise<{ latitude: number; longitude: number; accuracy: number | null }> {
  let permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted) {
    const approved = await confirmAction(
      "إذن الموقع",
      "نحتاج إلى موقع الجهاز أثناء تسجيل الحضور أو الانصراف ليقارن الخادم موقعك بموقع المشروع.",
    );
    if (!approved) return Promise.reject(new Error("يجب السماح بالموقع لإكمال تسجيل الحضور."));
    permission = await Location.requestForegroundPermissionsAsync();
  }

  if (!permission.granted) {
    if (!permission.canAskAgain) {
      Alert.alert(
        "إذن الموقع مطلوب",
        "فعّل الوصول إلى الموقع أثناء استخدام التطبيق من إعدادات الجهاز.",
        [
          { text: "إلغاء", style: "cancel" },
          { text: "فتح الإعدادات", onPress: openDeviceSettings },
        ],
      );
    }
    throw new Error("لم يُسمح بالوصول إلى الموقع. فعّل إذن الموقع ثم أعد المحاولة.");
  }

  if (Platform.OS !== "web" && !(await Location.hasServicesEnabledAsync())) {
    throw new Error("خدمة الموقع متوقفة. فعّل GPS أو خدمات الموقع ثم أعد المحاولة.");
  }

  try {
    const position = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      20_000,
    );
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("مهلة")) throw error;
    throw new Error("تعذّر تحديد موقعك الحالي. تحقق من GPS ثم أعد المحاولة.");
  }
}

function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "حدث خطأ غير متوقع. أعد المحاولة.";
}

function PageFrame({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.page, { backgroundColor: colors.background }, appInsets(insets.top, insets.bottom)]}>
      {children}
    </View>
  );
}

function LoadingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.loading, { backgroundColor: colors.background }, appInsets(insets.top, insets.bottom)]}>
      <Image source={require("../assets/images/icon.png")} style={styles.loadingLogo} />
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={[styles.mutedText, { color: colors.mutedForeground }]}>جارٍ التحقق من الجلسة…</Text>
    </View>
  );
}

function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { login, bootstrapError } = useAuth();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(bootstrapError);
  const [submitting, setSubmitting] = useState(false);

  async function submit(): Promise<void> {
    Keyboard.dismiss();
    if (!phone.trim()) {
      setError("أدخل رقم الهاتف.");
      return;
    }
    if (!password) {
      setError("أدخل كلمة المرور.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await login(phone, password);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (cause) {
      setError(errorText(cause));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={[styles.page, { backgroundColor: colors.background }, appInsets(insets.top, insets.bottom)]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={styles.loginScroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.loginBrand}>
          <Image source={require("../assets/images/icon.png")} style={styles.brandLogo} />
          <Text style={[styles.brandTitle, { color: colors.foreground }]}>إدارة الإشراف والمتابعة</Text>
          <Text style={[styles.brandSubtitle, { color: colors.mutedForeground }]}>
            سجّل دخولك لمتابعة مشاريعك وحضورك
          </Text>
        </View>

        <View style={[styles.loginPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.panelTitle, { color: colors.foreground }]}>تسجيل الدخول</Text>
          <Text style={[styles.panelHint, { color: colors.mutedForeground }]}>
            استخدم رقم الهاتف وكلمة المرور المسجلين في النظام
          </Text>

          <Text style={[styles.inputLabel, { color: colors.foreground }]}>رقم الهاتف</Text>
          <TextInput
            testID="login-phone"
            accessibilityLabel="رقم الهاتف"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            placeholder="أدخل رقم الهاتف"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
            textAlign="right"
            returnKeyType="next"
          />

          <Text style={[styles.inputLabel, { color: colors.foreground }]}>كلمة المرور</Text>
          <View style={[styles.passwordInputWrap, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <TextInput
              testID="login-password"
              accessibilityLabel="كلمة المرور"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoComplete="current-password"
              textContentType="password"
              placeholder="أدخل كلمة المرور"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.passwordInput, { color: colors.foreground }]}
              textAlign="right"
              returnKeyType="done"
              onSubmitEditing={() => void submit()}
            />
            <Pressable
              testID="toggle-password"
              accessibilityRole="button"
              accessibilityLabel={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
              onPress={() => setShowPassword(value => !value)}
              hitSlop={12}
              style={styles.passwordToggle}
            >
              <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={21} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {error ? (
            <View style={[styles.errorBox, { backgroundColor: colors.destructive + "12", borderColor: colors.destructive + "55" }]}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.destructive} />
              <Text accessibilityRole="alert" style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            testID="login-submit"
            accessibilityRole="button"
            disabled={submitting}
            onPress={() => void submit()}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: colors.primary, opacity: submitting ? 0.65 : pressed ? 0.84 : 1 },
            ]}
          >
            {submitting
              ? <ActivityIndicator color={colors.primaryForeground} />
              : <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>دخول إلى النظام</Text>}
          </Pressable>
        </View>
        <Text style={[styles.secureNote, { color: colors.mutedForeground }]}>
          تُحفظ الجلسة بأمان على هذا الجهاز.
        </Text>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

function ProjectCard({
  project,
  status,
  attendanceAllowed,
  busy,
  onAttendance,
}: {
  project: Project;
  status: MyAttendanceStatus | undefined;
  attendanceAllowed: boolean;
  busy: boolean;
  onAttendance: (project: Project, type: AttendanceType) => void;
}) {
  const colors = useColors();
  const checkedIn = status?.currentlyCheckedIn === true;
  const hasKnownStatus = status !== undefined;
  const action: AttendanceType = checkedIn ? "check_out" : "check_in";
  const statusColor = checkedIn ? colors.primary : colors.mutedForeground;
  const buttonForeground = action === "check_in" ? colors.primaryForeground : colors.destructiveForeground;

  return (
    <View style={[styles.projectCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.projectHeader}>
        <View style={[styles.projectIcon, { backgroundColor: colors.primary + "15" }]}>
          <Ionicons name="business-outline" size={21} color={colors.primary} />
        </View>
        <View style={styles.projectNameWrap}>
          <Text style={[styles.projectName, { color: colors.foreground }]} numberOfLines={2}>{project.name}</Text>
          <View style={styles.locationRow}>
            <Ionicons name="location-outline" size={14} color={colors.mutedForeground} />
            <Text style={[styles.locationText, { color: colors.mutedForeground }]} numberOfLines={1}>
              {project.location || "الموقع غير محدد"}
            </Text>
          </View>
        </View>
      </View>

      <View style={[styles.attendanceStatus, { backgroundColor: checkedIn ? colors.primary + "12" : colors.secondary }]}>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <Text style={[styles.statusText, { color: checkedIn ? colors.primary : colors.mutedForeground }]}>
          {!hasKnownStatus
            ? "حالة الحضور غير متاحة"
            : checkedIn
              ? "مسجّل حضور الآن"
              : "غير مسجّل حالياً"}
        </Text>
      </View>

      {status?.lastRecord ? (
        <Text style={[styles.lastRecord, { color: colors.mutedForeground }]}>
          آخر إجراء: {status.lastRecord.type === "check_in" ? "حضور" : "انصراف"} · {formatDate(status.lastRecord.recordedAt)}
        </Text>
      ) : null}

      {project.siteLatitude == null || project.siteLongitude == null ? (
        <View style={[styles.siteNotice, { backgroundColor: colors.accent + "18" }]}>
          <Ionicons name="information-circle-outline" size={16} color={colors.accent} />
          <Text style={[styles.siteNoticeText, { color: colors.foreground }]}>
            لم يُضبط موقع المشروع؛ سيتحقق الخادم من الموقع عند توفره.
          </Text>
        </View>
      ) : null}

      {!attendanceAllowed ? (
        <Text style={[styles.unavailableText, { color: colors.mutedForeground }]}>
          تسجيل الحضور غير متاح لهذا الدور.
        </Text>
      ) : (
        <Pressable
          testID={`${action}-${project.id}`}
          accessibilityRole="button"
          disabled={!hasKnownStatus || busy}
          onPress={() => onAttendance(project, action)}
          style={({ pressed }) => [
            styles.attendanceButton,
            {
              backgroundColor: action === "check_in" ? colors.primary : colors.destructive,
              opacity: !hasKnownStatus || busy ? 0.5 : pressed ? 0.82 : 1,
            },
          ]}
        >
          {busy
            ? <ActivityIndicator color={buttonForeground} />
            : <>
                <Ionicons name={action === "check_in" ? "log-in-outline" : "log-out-outline"} size={19} color={buttonForeground} />
                <Text style={[styles.attendanceButtonText, { color: buttonForeground }]}>{action === "check_in" ? "تسجيل حضور" : "تسجيل انصراف"}</Text>
              </>}
        </Pressable>
      )}
    </View>
  );
}

function ProjectsScreen({ user }: { user: SessionUser }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { logout, bootstrapError, isValidating, retrySessionValidation } = useAuth();
  const [operationProjectId, setOperationProjectId] = useState<number | null>(null);
  const projectsQuery = useQuery<Project[]>({
    queryKey: ["/projects"],
    enabled: !!user,
    retry: false,
  });
  const statusQuery = useQuery<MyAttendanceStatus[]>({
    queryKey: ["/attendance/my-status"],
    enabled: !!user,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
  });

  const canRecordForProject = (project: Project) => {
    if (user.role === "owner" || user.role === "contractor") return false;
    if (user.role === "admin" || user.role === "project_manager") return true;
    return !project.contractorCompanyId
      || !user.companies?.some(company => company.companyId === project.contractorCompanyId);
  };
  const statuses = useMemo(
    () => new Map((statusQuery.data ?? []).map(item => [item.projectId, item])),
    [statusQuery.data],
  );

  const attendanceMutation = useMutation({
    mutationFn: async ({ project, type }: { project: Project; type: AttendanceType }) => {
      const selfieBase64 = await captureSelfie();
      if (!selfieBase64) return null;
      const location = await getDeviceLocation();
      const route = type === "check_in" ? "check-in" : "check-out";
      return apiRequest<AttendanceRecord>(`/attendance/projects/${project.id}/${route}`, {
        method: "POST",
        textPlain: true,
        body: {
          selfieBase64,
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
          clientId: makeClientId(),
        },
      });
    },
    onMutate: variables => setOperationProjectId(variables.project.id),
    onSuccess: async (record, variables) => {
      if (!record) return;
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        variables.type === "check_in" ? "تم تسجيل الحضور" : "تم تسجيل الانصراف",
        "تم إرسال صورة الموقع والإحداثيات والتحقق منها بواسطة الخادم.",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/attendance/my-status"] }),
        queryClient.invalidateQueries({ queryKey: ["/projects"] }),
      ]);
    },
    onError: async error => {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("تعذّر إتمام التسجيل", errorText(error));
      // Refresh the authoritative state in case the server accepted the
      // request but the connection was lost before its response arrived.
      void queryClient.invalidateQueries({ queryKey: ["/attendance/my-status"] });
    },
    onSettled: () => setOperationProjectId(null),
  });

  async function refresh(): Promise<void> {
    await Promise.all([
      projectsQuery.refetch(),
      statusQuery.refetch(),
      retrySessionValidation(),
    ]);
  }

  function startAttendance(project: Project, type: AttendanceType): void {
    attendanceMutation.mutate({ project, type });
  }

  const currentTime = new Intl.DateTimeFormat("ar-LY", {
    timeZone: "Africa/Tripoli",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  const projects = projectsQuery.data ?? [];
  const checkedInCount = [...statuses.values()].filter(item => item.currentlyCheckedIn).length;
  const loading = projectsQuery.isLoading || statusQuery.isLoading;
  const listError = projectsQuery.error ?? statusQuery.error;

  return (
    <View style={[styles.page, { backgroundColor: colors.background }, appInsets(insets.top, insets.bottom)]}>
      <View style={styles.dashboardHeader}>
        <View style={styles.headerBrand}>
          <Image source={require("../assets/images/icon.png")} style={styles.headerLogo} />
          <View style={styles.headerTextWrap}>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>مشاريعي</Text>
            <Text style={[styles.headerDate, { color: colors.mutedForeground }]}>{currentTime}</Text>
          </View>
        </View>
        <Pressable
          testID="logout"
          accessibilityRole="button"
          accessibilityLabel="تسجيل الخروج"
          onPress={() => {
            Alert.alert("تسجيل الخروج", "هل تريد إنهاء جلستك على هذا الجهاز؟", [
              { text: "إلغاء", style: "cancel" },
              { text: "تسجيل الخروج", style: "destructive", onPress: () => void logout() },
            ]);
          }}
          hitSlop={10}
          style={[styles.logoutButton, { borderColor: colors.border }]}
        >
          <Ionicons name="log-out-outline" size={21} color={colors.foreground} />
        </Pressable>
      </View>

      <View style={[styles.welcomePanel, { backgroundColor: colors.primary }]}>
        <View style={styles.welcomeContent}>
          <Text style={[styles.welcomeLabel, { color: colors.primaryForeground + "CC" }]}>مرحباً</Text>
          <Text style={[styles.welcomeName, { color: colors.primaryForeground }]} numberOfLines={1}>{user.fullName || user.phone}</Text>
          <Text style={[styles.welcomeSubtext, { color: colors.primaryForeground + "DD" }]}>
            {projects.length} مشاريع متاحة · {checkedInCount} حضور نشط
          </Text>
        </View>
        <Ionicons name="construct-outline" size={34} color={colors.primaryForeground + "CC"} />
      </View>

      {bootstrapError ? (
        <View style={[styles.noticeBox, { backgroundColor: colors.accent + "18", borderColor: colors.accent + "66" }]}>
          <Ionicons name="cloud-offline-outline" size={18} color={colors.foreground} />
          <Text style={[styles.noticeText, { color: colors.foreground }]}>{bootstrapError}</Text>
          <Pressable onPress={() => void retrySessionValidation()}>
            <Text style={[styles.retryText, { color: colors.primary }]}>إعادة المحاولة</Text>
          </Pressable>
        </View>
      ) : null}

      {user.role === "owner" || user.role === "contractor" ? (
        <View style={[styles.noticeBox, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
          <Ionicons name="information-circle-outline" size={18} color={colors.mutedForeground} />
          <Text style={[styles.noticeText, { color: colors.mutedForeground }]}>
            يمكنك عرض المشاريع، لكن هذا الحساب لا يسجّل الحضور في النظام.
          </Text>
        </View>
      ) : null}

      {listError ? (
        <View style={[styles.noticeBox, { backgroundColor: colors.destructive + "12", borderColor: colors.destructive + "55" }]}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.destructive} />
          <Text style={[styles.noticeText, { color: colors.destructive }]}>{errorText(listError)}</Text>
          <Pressable onPress={() => void refresh()}>
            <Text style={[styles.retryText, { color: colors.primary }]}>إعادة المحاولة</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>المشاريع المتاحة</Text>
        <Pressable
          testID="refresh-projects"
          accessibilityRole="button"
          accessibilityLabel="تحديث المشاريع والحضور"
          disabled={projectsQuery.isFetching || statusQuery.isFetching || isValidating}
          onPress={() => void refresh()}
          hitSlop={8}
          style={styles.refreshButton}
        >
          {(projectsQuery.isFetching || statusQuery.isFetching || isValidating)
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Ionicons name="refresh-outline" size={20} color={colors.primary} />}
        </Pressable>
      </View>

      {loading && projects.length === 0 ? (
        <View style={styles.listLoading}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.mutedText, { color: colors.mutedForeground }]}>جارٍ تحميل المشاريع…</Text>
        </View>
      ) : (
        <FlatList
          testID="projects-list"
          data={projects}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={projects.length ? styles.projectList : styles.emptyList}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={projectsQuery.isFetching || statusQuery.isFetching}
              onRefresh={() => void refresh()}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.secondary }]}>
                <Ionicons name="business-outline" size={27} color={colors.mutedForeground} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>لا توجد مشاريع متاحة</Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                إذا كنت تتوقع ظهور مشروع هنا، تواصل مع مدير النظام للتحقق من صلاحيات حسابك.
              </Text>
              <Pressable
                onPress={() => void refresh()}
                style={[styles.secondaryButton, { borderColor: colors.border }]}
              >
                <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>تحديث القائمة</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => (
            <ProjectCard
              project={item}
              status={statuses.get(item.id)}
              attendanceAllowed={canRecordForProject(item)}
              busy={operationProjectId === item.id && attendanceMutation.isPending}
              onAttendance={startAttendance}
            />
          )}
        />
      )}
      {statusQuery.isError && !listError ? (
        <Text style={[styles.bottomError, { color: colors.destructive }]}>
          تعذّر تحديث حالة الحضور. اسحب القائمة للأسفل أو أعد المحاولة.
        </Text>
      ) : null}
    </View>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const { credential, isReady } = useAuth();
  if (!isReady) return <LoadingScreen />;
  return credential
    ? <ProjectsScreen user={credential.user} />
    : <LoginScreen />;
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  loadingLogo: { width: 70, height: 70, borderRadius: 18 },
  mutedText: { fontSize: 14, fontFamily: "NotoKufiArabic_400Regular", textAlign: "center" },
  loginScroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 22, paddingVertical: 26 },
  loginBrand: { alignItems: "center", marginBottom: 28 },
  brandLogo: { width: 76, height: 76, borderRadius: 20, marginBottom: 16 },
  brandTitle: { fontSize: 19, fontFamily: "NotoKufiArabic_700Bold", textAlign: "center" },
  brandSubtitle: { fontSize: 13, fontFamily: "NotoKufiArabic_400Regular", marginTop: 8, textAlign: "center" },
  loginPanel: { borderRadius: 19, borderWidth: 1, padding: 20 },
  panelTitle: { fontSize: 18, fontFamily: "NotoKufiArabic_700Bold", textAlign: "right" },
  panelHint: { fontSize: 12, lineHeight: 22, fontFamily: "NotoKufiArabic_400Regular", textAlign: "right", marginTop: 5, marginBottom: 17 },
  inputLabel: { fontSize: 13, fontFamily: "NotoKufiArabic_600SemiBold", textAlign: "right", marginBottom: 7 },
  input: { height: 49, borderWidth: 1, borderRadius: 11, paddingHorizontal: 13, fontSize: 14, fontFamily: "NotoKufiArabic_400Regular", marginBottom: 15 },
  passwordInputWrap: { height: 49, borderWidth: 1, borderRadius: 11, flexDirection: "row", alignItems: "center", marginBottom: 12 },
  passwordInput: { flex: 1, height: "100%", paddingHorizontal: 13, fontSize: 14, fontFamily: "NotoKufiArabic_400Regular" },
  passwordToggle: { paddingHorizontal: 13, height: "100%", justifyContent: "center" },
  errorBox: { borderWidth: 1, borderRadius: 10, flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 11, marginBottom: 12 },
  errorText: { flex: 1, fontSize: 12, lineHeight: 20, fontFamily: "NotoKufiArabic_400Regular", textAlign: "right" },
  primaryButton: { minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: 12, marginTop: 6 },
  primaryButtonText: { fontSize: 14, fontFamily: "NotoKufiArabic_700Bold" },
  secureNote: { marginTop: 16, fontSize: 11, fontFamily: "NotoKufiArabic_400Regular", textAlign: "center" },
  dashboardHeader: { minHeight: 64, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 19, paddingBottom: 8 },
  headerBrand: { flexDirection: "row", alignItems: "center", gap: 11 },
  headerLogo: { width: 43, height: 43, borderRadius: 12 },
  headerTextWrap: { alignItems: "flex-start" },
  headerTitle: { fontSize: 18, fontFamily: "NotoKufiArabic_700Bold" },
  headerDate: { fontSize: 11, fontFamily: "NotoKufiArabic_400Regular", marginTop: 1 },
  logoutButton: { width: 41, height: 41, borderWidth: 1, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  welcomePanel: { marginHorizontal: 18, marginTop: 9, paddingHorizontal: 17, paddingVertical: 17, borderRadius: 17, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  welcomeContent: { flex: 1, alignItems: "flex-start" },
  welcomeLabel: { fontSize: 11, fontFamily: "NotoKufiArabic_400Regular" },
  welcomeName: { fontSize: 18, fontFamily: "NotoKufiArabic_700Bold", marginTop: 2 },
  welcomeSubtext: { fontSize: 11, fontFamily: "NotoKufiArabic_400Regular", marginTop: 5 },
  noticeBox: { marginHorizontal: 18, marginTop: 12, borderWidth: 1, borderRadius: 12, padding: 11, flexDirection: "row", alignItems: "center", gap: 8 },
  noticeText: { flex: 1, fontSize: 11, lineHeight: 18, fontFamily: "NotoKufiArabic_400Regular", textAlign: "right" },
  retryText: { fontSize: 11, fontFamily: "NotoKufiArabic_700Bold" },
  sectionHeader: { marginTop: 21, marginBottom: 10, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 15, fontFamily: "NotoKufiArabic_700Bold" },
  refreshButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  listLoading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  projectList: { paddingHorizontal: 17, paddingBottom: 14, gap: 12 },
  emptyList: { flexGrow: 1, justifyContent: "center", padding: 28 },
  emptyState: { alignItems: "center", justifyContent: "center", paddingVertical: 22 },
  emptyIcon: { width: 62, height: 62, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 16, fontFamily: "NotoKufiArabic_700Bold", marginTop: 14, textAlign: "center" },
  emptyText: { fontSize: 12, lineHeight: 22, fontFamily: "NotoKufiArabic_400Regular", textAlign: "center", marginTop: 7 },
  secondaryButton: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 17, paddingVertical: 9, marginTop: 15 },
  secondaryButtonText: { fontSize: 12, fontFamily: "NotoKufiArabic_600SemiBold" },
  projectCard: { borderWidth: 1, borderRadius: 16, padding: 14 },
  projectHeader: { flexDirection: "row", alignItems: "center", gap: 11 },
  projectIcon: { width: 43, height: 43, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  projectNameWrap: { flex: 1, alignItems: "flex-start" },
  projectName: { fontSize: 14, lineHeight: 22, fontFamily: "NotoKufiArabic_700Bold", textAlign: "right" },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 3 },
  locationText: { flexShrink: 1, fontSize: 11, fontFamily: "NotoKufiArabic_400Regular", textAlign: "right" },
  attendanceStatus: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 7, borderRadius: 18, paddingHorizontal: 10, paddingVertical: 6, marginTop: 14 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 11, fontFamily: "NotoKufiArabic_600SemiBold" },
  lastRecord: { fontSize: 11, fontFamily: "NotoKufiArabic_400Regular", textAlign: "right", marginTop: 8 },
  siteNotice: { flexDirection: "row", alignItems: "flex-start", gap: 6, borderRadius: 9, padding: 8, marginTop: 10 },
  siteNoticeText: { flex: 1, fontSize: 10, lineHeight: 17, fontFamily: "NotoKufiArabic_400Regular", textAlign: "right" },
  unavailableText: { marginTop: 13, fontSize: 11, fontFamily: "NotoKufiArabic_600SemiBold", textAlign: "center" },
  attendanceButton: { minHeight: 45, borderRadius: 11, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 13 },
  attendanceButtonText: { fontSize: 13, fontFamily: "NotoKufiArabic_700Bold" },
  bottomError: { fontSize: 10, fontFamily: "NotoKufiArabic_400Regular", textAlign: "center", paddingHorizontal: 16, paddingBottom: 5 },
});
