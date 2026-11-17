<script setup lang="ts">
import { Form } from '@adonisjs/inertia/vue'
import AppLayout from '~/layouts/app.vue'
import SettingsLayout from '~/layouts/settings.vue'
defineOptions({ layout: [AppLayout, SettingsLayout] })
defineProps<{ body: string; pending: boolean }>()
</script>
<template>
  <section>
    <h2>Secure note</h2>
    <p>Saved note: {{ body }}</p>
    <Form v-slot="{ processing }" method="post" route="secure_notes.confirm">
      <label for="body">New note</label><input id="body" name="body" maxlength="500" required />
      <label for="password">Current password</label
      ><input id="password" name="password" type="password" required />
      <button type="submit" :disabled="processing">Confirm password</button>
    </Form>
    <Form v-if="pending" v-slot="{ processing }" method="post" route="secure_notes.update">
      <button type="submit" :disabled="processing">Save confirmed note</button>
    </Form>
  </section>
</template>
