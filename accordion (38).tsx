import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Card, Empty, PrimaryButton, Screen } from "@/components/Screen";
import { useColors } from "@/hooks/useColors";
import { ApiError, apiCreateFormSubmission, apiGetFormTemplate } from "@/lib/api";

export default function FormFillScreen() {
  const { id, templateId } = useLocalSearchParams<{ id: string; templateId: string }>();
  const projectId = Number(id);
  const tplId = Number(templateId);
  const colors = useColors();
  const qc = useQueryClient();

  const tplQ = useQuery({ queryKey: ["form-tpl", projectId, tplId], queryFn: () => apiGetFormTemplate(projectId, tplId), enabled: Number.isFinite(projectId) && Number.isFinite(tplId) });
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [values, setValues] = useState<Record<string, unknown>>({});

  const submit = useMutation({
    mutationFn: () => apiCreateFormSubmission(projectId, { templateId: tplId, reportDate, data: values }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["form-submissions", projectId] });
      Alert.alert("تم", "تم حفظ النموذج بنجاح.");
      router.back();
    },
    onError: (e) => Alert.alert("خطأ", e instanceof ApiError ? e.message : "فشل حفظ النموذج"),
  });

  const tpl = tplQ.data;

  function setField(id: string, v: unknown) {
    setValues(prev => ({ ...prev, [id]: v }));
  }

  function validateAndSubmit() {
    if (!tpl) return;
    for (const f of tpl.fields) {
      if (f.required) {
        const v = values[f.id];
        if (v == null || (typeof v === "string" && v.trim() === "")) {
          Alert.alert("حقل مطلوب", `الحقل "${f.label}" مطلوب`); return;
        }
      }
    }
    submit.mutate();
  }

  return (
    <Screen title={tpl?.name ?? "نموذج"} back>
      {tplQ.isLoading ? (
        <Card><Text style={{ color: colors.mutedForeground, fontFamily: "Cairo_400Regular" }}>جاري التحميل…</Text></Card>
      ) : !tpl ? (
        <Empty icon="alert-circle" title="تعذّر تحميل النموذج" />
      ) : (
        <>
          <Card>
            <Text style={[styles.label, { color: colors.foreground }]}>التاريخ</Text>
            <TextInput value={reportDate} onChangeText={setReportDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.input }]} textAlign="right" />
          </Card>

          {tpl.fields.map(f => (
            <Card key={f.id}>
              <Text style={[styles.label, { color: colors.foreground }]}>
                {f.label}{f.required ? <Text style={{ color: colors.destructive }}> *</Text> : null}
              </Text>
              {renderField(f, values[f.id], (v) => setField(f.id, v), colors)}
            </Card>
          ))}

          <PrimaryButton label="إرسال" icon="send" loading={submit.isPending} onPress={validateAndSubmit} />
        </>
      )}
    </Screen>
  );
}

function renderField(
  f: { id: string; label: string; type: string; required?: boolean; options?: string[] },
  value: unknown,
  setValue: (v: unknown) => void,
  colors: ReturnType<typeof useColors>,
) {
  const baseInput = [styles.input, { color: colors.foreground, borderColor: colors.input }];
  switch (f.type) {
    case "number":
      return <TextInput value={value == null ? "" : String(value)} onChangeText={(t) => setValue(t === "" ? "" : Number(t.replace(/[^0-9.\-]/g, "")))} keyboardType="numeric" style={baseInput} textAlign="right" />;
    case "textarea":
      return <TextInput value={String(value ?? "")} onChangeText={setValue} multiline style={[...baseInput, styles.area]} textAlign="right" textAlignVertical="top" />;
    case "boolean":
    case "checkbox":
      return (
        <TouchableOpacity onPress={() => setValue(!value)} style={[styles.checkbox, { borderColor: colors.border, backgroundColor: value ? colors.primary : colors.card }]}>
          <Text style={{ color: value ? colors.primaryForeground : colors.foreground, fontFamily: "Cairo_600SemiBold" }}>{value ? "نعم" : "لا"}</Text>
        </TouchableOpacity>
      );
    case "select":
    case "radio": {
      const options = f.options ?? [];
      return (
        <View style={styles.chipsRow}>
          {options.map(opt => (
            <Text
              key={opt}
              onPress={() => setValue(opt)}
              style={[
                styles.chip,
                {
                  backgroundColor: value === opt ? colors.primary : colors.secondary,
                  color: value === opt ? colors.primaryForeground : colors.foreground,
                  borderColor: value === opt ? colors.primary : colors.border,
                },
              ]}
            >
              {opt}
            </Text>
          ))}
        </View>
      );
    }
    case "date":
      return <TextInput value={String(value ?? "")} onChangeText={setValue} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} style={baseInput} textAlign="right" />;
    default:
      return <TextInput value={String(value ?? "")} onChangeText={setValue} style={baseInput} textAlign="right" />;
  }
}

const styles = StyleSheet.create({
  label: { fontFamily: "Cairo_600SemiBold", fontSize: 13, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: "Cairo_400Regular", fontSize: 14, minHeight: 44 },
  area: { minHeight: 92 },
  checkbox: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1, alignSelf: "flex-start" },
  chipsRow: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, fontFamily: "Cairo_600SemiBold", fontSize: 13, overflow: "hidden" },
});
