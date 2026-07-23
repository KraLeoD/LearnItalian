import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Card, HelperText, Snackbar, Text, TextInput, useTheme } from 'react-native-paper';
import { api, ApiError } from '../api';
import { AudioPlayer, CategoryPicker, EntryCard, VoicePicker } from '../components';
import type { Category, Entry, VoiceOption } from '../types';

export function NewScreen({ categories, voices, voice, onVoiceChange, onChanged }: {
  categories: Category[]; voices: VoiceOption[]; voice: string; onVoiceChange: (voice: string) => void; onChanged: () => void;
}) {
  const theme = useTheme();
  const [text, setText] = useState('');
  const [batchMode, setBatchMode] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [phase, setPhase] = useState<'idle' | 'translation' | 'audio'>('idle');
  const [message, setMessage] = useState('');
  const [busyEntry, setBusyEntry] = useState(false);
  const submitting = useRef(false);
  const trimmed = text.trim();
  const sourceTexts = batchMode ? text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [trimmed];
  const canGenerate = Boolean(trimmed) && (!batchMode || sourceTexts.length >= 2);
  const isBatchResult = Boolean(entries[0]?.batchId);

  async function generate() {
    if (!canGenerate || submitting.current) return;
    submitting.current = true;
    setEntries([]); setMessage(''); setPhase('translation');
    const timer = setTimeout(() => setPhase('audio'), 900);
    try {
      const generated = batchMode ? (await api.generateBatch(sourceTexts, categoryId, voice)).entries : [(await api.generate(trimmed, categoryId, voice)).entry];
      setEntries(generated);
      setText('');
      setPhase('idle');
      setMessage(generated[0]?.audioStatus === 'ready' ? (batchMode ? `${generated.length} Sätze gespeichert.` : 'Eintrag gespeichert.') : 'Übersetzung gespeichert. Audio konnte nicht erstellt werden.');
      onChanged();
    } catch (error) {
      setPhase('idle');
      setMessage(error instanceof ApiError ? error.message : 'Etwas ist schiefgegangen.');
    } finally {
      clearTimeout(timer); submitting.current = false;
    }
  }

  async function retryAudio(current: Entry) {
    setBusyEntry(true);
    try {
      const result = await api.retryAudio(current.id);
      setEntries((all) => all.map((item) => item.id === current.id || (current.batchId && item.batchId === current.batchId)
        ? { ...item, audioStatus: result.entry.audioStatus, audioUrl: result.entry.audioUrl, updatedAt: result.entry.updatedAt }
        : item));
      setMessage('Audio wurde erstellt.'); onChanged();
    }
    catch (error) { setMessage(error instanceof ApiError ? error.message : 'Audio konnte nicht erstellt werden.'); }
    finally { setBusyEntry(false); }
  }

  async function deleteEntry(current: Entry) {
    setBusyEntry(true);
    try {
      await api.deleteEntry(current.id);
      setEntries((all) => all.filter((item) => item.id !== current.id).map((item) => current.batchId && item.batchId === current.batchId ? { ...item, audioStatus: 'failed', audioUrl: null } : item));
      setMessage(current.batchId ? 'Eintrag gelöscht. Das gemeinsame Audio kann bei Bedarf neu erstellt werden.' : 'Eintrag und nicht mehr benötigtes Audio gelöscht.'); onChanged();
    }
    catch (error) { setMessage(error instanceof ApiError ? error.message : 'Eintrag konnte nicht gelöscht werden.'); }
    finally { setBusyEntry(false); }
  }

  async function assign(current: Entry, nextCategory: string | null) {
    setBusyEntry(true);
    try { const result = await api.assignCategory(current.id, nextCategory); setEntries((all) => all.map((item) => item.id === current.id ? result.entry : item)); onChanged(); }
    catch (error) { setMessage(error instanceof ApiError ? error.message : 'Kategorie konnte nicht geändert werden.'); }
    finally { setBusyEntry(false); }
  }

  return (
    <View style={styles.page}>
      <View style={styles.heading}>
        <Text variant="displaySmall">Was möchtest du sagen?</Text>
        <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant }}>Schreibe einen Satz aus deinem Alltag. Wir übersetzen ihn und sprechen ihn für dich vor.</Text>
      </View>
      <Card mode="elevated" style={styles.formCard}>
        <Card.Content style={styles.form}>
          <Button mode={batchMode ? 'contained-tonal' : 'outlined'} icon="format-list-bulleted" disabled={phase !== 'idle'} onPress={() => { setBatchMode((current) => !current); setEntries([]); }}>
            {batchMode ? 'Mehrere Sätze aktiv' : 'Mehrere Sätze eingeben'}
          </Button>
          <TextInput
            mode="outlined" label={batchMode ? 'Deutsche Sätze – einer pro Zeile' : 'Deutscher Text'} placeholder={batchMode ? 'Wo ist der Bahnhof?\nWann fährt der nächste Zug?\nZwei Fahrkarten, bitte.' : 'Zum Beispiel: Wo ist der nächste Bahnhof?'}
            value={text} onChangeText={setText} multiline numberOfLines={5} maxLength={2000}
            disabled={phase !== 'idle'} autoFocus accessibilityLabel="Deutschen Text eingeben"
            style={styles.input}
          />
          <View style={styles.counter}><HelperText type={trimmed.length > 1800 ? 'error' : 'info'} visible>{batchMode ? `${sourceTexts.length} Sätze · ` : ''}{text.length} / 2000 Zeichen{batchMode && sourceTexts.length < 2 ? ' · mindestens 2 Zeilen' : ''}</HelperText></View>
          <View style={styles.selectors}>
            <Button mode="outlined" icon="translate" disabled contentStyle={styles.largeControl}>Italienisch</Button>
            <VoicePicker voices={voices} value={voice} onChange={onVoiceChange} />
            <CategoryPicker categories={categories} value={categoryId} onChange={setCategoryId} />
          </View>
          <Button mode="contained" icon="auto-awesome" onPress={generate} disabled={!canGenerate || phase !== 'idle' || !voices.length} loading={phase !== 'idle'} contentStyle={styles.primaryAction}>
            {batchMode ? 'Alle übersetzen und gemeinsames Audio erstellen' : 'Übersetzen und Audio erstellen'}
          </Button>
          {phase !== 'idle' ? (
            <View accessibilityLiveRegion="polite" style={[styles.progress, { backgroundColor: theme.colors.secondaryContainer }]}>
              <ActivityIndicator size="small" />
              <Text variant="bodyLarge">{phase === 'translation' ? 'Text wird übersetzt …' : 'Audio wird erstellt …'}</Text>
            </View>
          ) : null}
        </Card.Content>
      </Card>
      {entries.length ? <View style={styles.result}>
        <Text variant="titleLarge">{isBatchResult ? `Deine ${entries.length} neuen Sätze` : 'Dein neuer Satz'}</Text>
        {isBatchResult ? <Card mode="outlined"><Card.Content style={styles.batchAudio}>
          <Text variant="titleMedium">Gemeinsame Aussprache</Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>Alle italienischen Sätze werden in ihrer Reihenfolge abgespielt.</Text>
          {entries[0]?.audioStatus === 'ready' && entries[0].audioUrl ? <AudioPlayer url={entries[0].audioUrl} /> : <Button mode="contained-tonal" icon="refresh" loading={busyEntry} disabled={busyEntry} onPress={() => entries[0] && retryAudio(entries[0])}>Gemeinsames Audio erstellen</Button>}
        </Card.Content></Card> : null}
        <View style={styles.resultList}>{entries.map((entry) => <EntryCard
          key={entry.id} entry={entry} categories={categories} busy={busyEntry} hideAudio={isBatchResult}
          onRetryAudio={retryAudio} onDelete={deleteEntry} onAssign={assign}
        />)}</View>
      </View> : null}
      <Snackbar visible={Boolean(message)} onDismiss={() => setMessage('')} duration={5000} action={{ label: 'OK', onPress: () => setMessage('') }}>{message}</Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { width: '100%', maxWidth: 820, alignSelf: 'center', gap: 28, paddingBottom: 40 },
  heading: { gap: 8 }, formCard: { borderRadius: 24 }, form: { gap: 16, paddingVertical: 12 },
  input: { minHeight: 148, textAlignVertical: 'top' }, counter: { alignItems: 'flex-end', marginTop: -14 },
  selectors: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, largeControl: { minHeight: 48 },
  primaryAction: { minHeight: 56 }, progress: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 16, borderRadius: 14 },
  result: { gap: 12 },
  resultList: { gap: 16 },
  batchAudio: { gap: 12 },
});
