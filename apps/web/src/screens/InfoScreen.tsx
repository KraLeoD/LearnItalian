import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Card, ProgressBar, Switch, Text, useTheme } from 'react-native-paper';
import { api } from '../api';
import type { Info } from '../types';

export function InfoScreen({ dark, onToggleDark }: { dark: boolean; onToggleDark: () => void }) {
  const theme = useTheme();
  const [info, setInfo] = useState<Info | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const loadInfo = useCallback(async (showSpinner = true) => {
    if (showSpinner) setRefreshing(true);
    try { setInfo(await api.info()); setLastUpdated(new Date()); setError(''); }
    catch { setError('Die Nutzungsdaten konnten nicht aktualisiert werden.'); }
    finally { if (showSpinner) setRefreshing(false); }
  }, []);
  useEffect(() => {
    void loadInfo(false);
    const timer = setInterval(() => { void loadInfo(false); }, 30_000);
    return () => clearInterval(timer);
  }, [loadInfo]);
  const format = new Intl.NumberFormat('de-DE');
  return (
    <View style={styles.page}>
      <View style={styles.heading}><Text variant="displaySmall">Einstellungen & Info</Text><Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant }}>Weniger Technik, mehr Italienisch.</Text></View>
      <Card mode="elevated"><Card.Content style={styles.section}>
        <View style={styles.switchRow}><View style={styles.switchText}><Text variant="titleMedium">Dunkles Design</Text><Text style={{ color: theme.colors.onSurfaceVariant }}>Angenehm bei wenig Licht</Text></View><Switch value={dark} onValueChange={onToggleDark} accessibilityLabel="Dunkles Design umschalten" /></View>
      </Card.Content></Card>
      <Card mode="elevated"><Card.Content style={styles.section}>
        <View style={styles.usageHeading}>
          <View><Text variant="titleLarge">Monatliche Nutzung</Text>{lastUpdated ? <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>Aktualisiert um {lastUpdated.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</Text> : null}</View>
          <Button mode="outlined" compact icon="refresh" loading={refreshing} disabled={refreshing} onPress={() => void loadInfo()}>Aktualisieren</Button>
        </View>
        {!info ? <ActivityIndicator /> : <>
          <UsageRow label="Übersetzungen" used={info.usage.translation.used} limit={info.usage.translation.limit} />
          <UsageRow label="Sprachausgabe" used={info.usage.speech.used} limit={info.usage.speech.limit} />
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>Zeichen im Monat {info.month}. Interne Zähler sind nur eine Schutzfunktion und ersetzen nicht die Kontingentanzeige von Azure.</Text>
          {info.providerMode === 'mock' ? <Text style={{ color: theme.colors.tertiary }}>Lokaler Testmodus ist aktiv – es werden keine Azure-Aufrufe ausgeführt.</Text> : null}
        </>}
        {error ? <Text style={{ color: theme.colors.error }}>{error}</Text> : null}
      </Card.Content></Card>
      <Card mode="outlined"><Card.Content style={styles.section}>
        <Text variant="titleLarge">Datenschutz & Zugang</Text>
        <Text variant="bodyMedium">Diese App hat bewusst keine Benutzerkonten. Betreibe sie nur in einem vertrauenswürdigen Netzwerk oder schütze sie am Ingress, zum Beispiel mit Authentik.</Text>
        <Text variant="bodyMedium">Azure-Schlüssel können aus Sicherheitsgründen nicht in dieser Oberfläche eingegeben oder geändert werden. Sie werden ausschließlich serverseitig konfiguriert.</Text>
      </Card.Content></Card>
    </View>
  );

  function UsageRow({ label, used, limit }: { label: string; used: number; limit: number }) {
    const progress = Math.min(1, used / limit);
    return <View style={styles.usage}><View style={styles.usageLabels}><Text variant="labelLarge">{label}</Text><Text>{format.format(used)} / {format.format(limit)} Zeichen</Text></View><ProgressBar progress={progress} accessibilityLabel={`${label}: ${used} von ${limit} Zeichen`} /></View>;
  }
}

const styles = StyleSheet.create({
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: 20, paddingBottom: 40 }, heading: { gap: 8 }, section: { gap: 18 },
  usageHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, switchText: { gap: 3 }, usage: { gap: 8 }, usageLabels: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
});
