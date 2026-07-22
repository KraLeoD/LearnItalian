import React, { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Button, Card, Dialog, IconButton, Portal, Snackbar, Text, TextInput, useTheme } from 'react-native-paper';
import { api, ApiError } from '../api';
import type { Category } from '../types';

export function CategoriesScreen({ categories, reload }: { categories: Category[]; reload: () => Promise<void> }) {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<Category | null>(null);
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try { await api.createCategory(name.trim()); setName(''); await reload(); setMessage('Kategorie erstellt.'); }
    catch (error) { setMessage(error instanceof ApiError ? error.message : 'Kategorie konnte nicht erstellt werden.'); }
    finally { setBusy(false); }
  }
  async function rename() {
    if (!editing || !editName.trim()) return;
    setBusy(true);
    try { await api.renameCategory(editing.id, editName.trim()); setEditing(null); await reload(); setMessage('Kategorie umbenannt.'); }
    catch (error) { setMessage(error instanceof ApiError ? error.message : 'Kategorie konnte nicht umbenannt werden.'); }
    finally { setBusy(false); }
  }
  async function remove(category: Category) {
    const confirmed = Platform.OS === 'web' ? globalThis.confirm(`Kategorie „${category.name}“ löschen? Die Sätze bleiben erhalten.`) : true;
    if (!confirmed) return;
    setBusy(true);
    try { await api.deleteCategory(category.id); await reload(); setMessage('Kategorie gelöscht. Die Sätze bleiben erhalten.'); }
    catch (error) { setMessage(error instanceof ApiError ? error.message : 'Kategorie konnte nicht gelöscht werden.'); }
    finally { setBusy(false); }
  }

  return (
    <View style={styles.page}>
      <View style={styles.heading}><Text variant="displaySmall">Kategorien</Text><Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant }}>Ordne deine Sätze nach den Bereichen, die für dich wichtig sind.</Text></View>
      <Card mode="elevated" style={styles.createCard}><Card.Content style={styles.createRow}>
        <TextInput mode="outlined" label="Neue Kategorie" placeholder="z. B. Reisen" value={name} onChangeText={setName} maxLength={60} style={styles.input} onSubmitEditing={create} />
        <Button mode="contained" icon="plus" onPress={create} loading={busy} disabled={busy || !name.trim()} contentStyle={styles.button}>Hinzufügen</Button>
      </Card.Content></Card>
      {categories.length === 0 ? <View style={[styles.empty, { backgroundColor: theme.colors.surfaceVariant }]}><Text variant="headlineSmall">Noch keine Kategorien</Text><Text>Erstelle zum Beispiel „Alltag“, „Arbeit“ oder „Reisen“.</Text></View> : null}
      <View style={styles.list}>{categories.map((category) => (
        <Card key={category.id} mode="outlined"><Card.Content style={styles.row}>
          <View style={styles.categoryName}><IconButton icon="folder-outline" /><Text variant="titleMedium">{category.name}</Text></View>
          <View style={styles.actions}><IconButton icon="pencil-outline" accessibilityLabel={`${category.name} umbenennen`} onPress={() => { setEditing(category); setEditName(category.name); }} /><IconButton icon="delete-outline" accessibilityLabel={`${category.name} löschen`} onPress={() => remove(category)} /></View>
        </Card.Content></Card>
      ))}</View>
      <Portal><Dialog visible={Boolean(editing)} onDismiss={() => setEditing(null)}>
        <Dialog.Title>Kategorie umbenennen</Dialog.Title><Dialog.Content><TextInput mode="outlined" label="Name" value={editName} onChangeText={setEditName} autoFocus maxLength={60} /></Dialog.Content>
        <Dialog.Actions><Button onPress={() => setEditing(null)}>Abbrechen</Button><Button onPress={rename} disabled={!editName.trim() || busy} loading={busy}>Speichern</Button></Dialog.Actions>
      </Dialog></Portal>
      <Snackbar visible={Boolean(message)} onDismiss={() => setMessage('')} duration={5000}>{message}</Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: 24, paddingBottom: 40 }, heading: { gap: 8 },
  createCard: { borderRadius: 20 }, createRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }, input: { flex: 1, minWidth: 220 }, button: { minHeight: 48 },
  list: { gap: 12 }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, categoryName: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  actions: { flexDirection: 'row' }, empty: { alignItems: 'center', gap: 8, padding: 32, borderRadius: 20 },
});
