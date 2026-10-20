import { useEffect, useRef, useState } from "react";
import { Alert, Button, Group, Modal, Radio, Stack, Text, Textarea } from "@mantine/core";
import type { ChatQuestion, ClientSettings } from "@rex/shared";
import * as api from "./api";

export function ChatQuestionCard({ question, settings, onAnswered }: { question: ChatQuestion; settings: ClientSettings; onAnswered: () => void }) {
  const [opened, setOpened] = useState(false);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (question.answeredAt) setOpened(false); }, [question.answeredAt]);
  const answers = question.questions.map((q) => q.options.length && choices[q.id] !== "custom" ? q.options[Number(choices[q.id])] ?? "" : custom[q.id] ?? "");
  async function submit() {
    if (sending || answers.some((answer) => !answer.trim())) return;
    setSending(true);
    setError(null);
    try {
      await api.answerQuestion(question.id, answers, settings);
      if (mounted.current) { setOpened(false); onAnswered(); }
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (mounted.current) setSending(false); }
  }
  return <Stack gap="sm" className="chat-question-card">
    {question.questions.map((q) => <Text key={q.id}>{q.question}</Text>)}
    {question.answeredAt ? <Text size="sm" c="dimmed" role="status">Answered</Text> : <Button variant="default" onClick={() => setOpened(true)} style={{ alignSelf: "flex-start" }}>Answer {question.questions.length === 1 ? "question" : "questions"}</Button>}
    <Modal opened={opened} onClose={() => { if (!sending) setOpened(false); }} title="Answer questions" centered closeButtonProps={{ "aria-label": "Close questions" }}>
      <form className="chat-question-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <Stack gap="lg">
          {question.questions.map((q) => <Stack gap="sm" key={q.id}>
            {q.options.length ? <Radio.Group label={q.question} value={choices[q.id] ?? ""} onChange={(value) => setChoices((current) => ({ ...current, [q.id]: value }))}>
              <Stack gap={4} mt="xs">{q.options.map((option, index) => <Radio key={option} value={String(index)} label={option} className="chat-question-option" disabled={sending} />)}<Radio value="custom" label="Write my own answer" className="chat-question-option" disabled={sending} /></Stack>
            </Radio.Group> : null}
            {!q.options.length || choices[q.id] === "custom" ? <Textarea label={q.options.length ? `Your answer: ${q.question}` : q.question} value={custom[q.id] ?? ""} onChange={(event) => { const value = event.currentTarget.value; setCustom((current) => ({ ...current, [q.id]: value })); }} autosize minRows={2} maxRows={5} maxLength={2000} disabled={sending} /> : null}
          </Stack>)}
          {error ? <Alert color="red" role="alert">{error}</Alert> : null}
          <Group justify="flex-end"><Button variant="subtle" disabled={sending} onClick={() => setOpened(false)}>Cancel</Button><Button type="submit" loading={sending} disabled={answers.some((answer) => !answer.trim())}>Send answers</Button></Group>
        </Stack>
      </form>
    </Modal>
  </Stack>;
}
