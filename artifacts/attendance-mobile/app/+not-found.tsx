import { Link, Stack } from 'expo-router';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

export default function NotFoundScreen() {
  const colors = useColors();

  return (
    <>
      <Stack.Screen options={{ title: 'الصفحة غير موجودة' }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Image source={require('../assets/images/icon.png')} style={styles.logo} />
        <Text style={[styles.brand, { color: colors.foreground }]}>ركاز - RIKAZ</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>
          الصفحة غير موجودة
        </Text>

        <Link href="/" style={styles.link}>
          <Text style={[styles.linkText, { color: colors.primary }]}>
          العودة إلى الصفحة الرئيسية
          </Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  logo: {
    width: 76,
    height: 76,
    borderRadius: 20,
    marginBottom: 14,
  },
  brand: {
    fontSize: 17,
    fontFamily: 'NotoKufiArabic_700Bold',
    marginBottom: 14,
  },
  title: {
    fontSize: 20,
    fontFamily: 'NotoKufiArabic_700Bold',
    textAlign: 'center',
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
  linkText: {
    fontSize: 14,
    fontFamily: 'NotoKufiArabic_600SemiBold',
  },
});
