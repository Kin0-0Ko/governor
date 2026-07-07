'use client';
import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { TextField, Label, Input, FieldError, Button, Alert } from '@heroui/react';
import { useCreateBudgetMutation } from '../../store/api/governor.api';

interface FormErrors {
  orgId?: string;
  jobId?: string;
  targetId?: string;
  capUsd?: string;
  halfOpenTtlSeconds?: string;
}

function isFetchBaseQueryError(err: unknown): err is { status: number; data?: { message?: string | string[] } } {
  return typeof err === 'object' && err !== null && 'status' in err;
}

export function BudgetForm() {
  const router = useRouter();
  const [create, { isLoading }] = useCreateBudgetMutation();
  const [form, setForm] = useState({
    orgId: '',
    jobId: '',
    targetId: '',
    capUsd: '',
    halfOpenTtlSeconds: '60',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((er) => ({ ...er, [field]: undefined }));
  };

  function validate(): FormErrors {
    const next: FormErrors = {};
    if (!form.orgId.trim()) next.orgId = 'Required';
    if (!form.jobId.trim()) next.jobId = 'Required';
    if (!form.targetId.trim()) next.targetId = 'Required';

    const capUsd = parseFloat(form.capUsd);
    if (form.capUsd.trim() === '' || isNaN(capUsd) || capUsd <= 0) {
      next.capUsd = 'Cap must be a positive number';
    }

    const ttl = parseInt(form.halfOpenTtlSeconds, 10);
    if (isNaN(ttl) || ttl < 10 || ttl > 3600) {
      next.halfOpenTtlSeconds = 'TTL must be between 10 and 3600 seconds';
    }

    return next;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    const validation = validate();
    if (Object.keys(validation).length > 0) {
      setErrors(validation);
      return;
    }

    const capMicros = BigInt(Math.round(parseFloat(form.capUsd) * 1_000_000)).toString();
    const ttl = parseInt(form.halfOpenTtlSeconds, 10);

    try {
      const budget = await create({
        orgId: form.orgId,
        jobId: form.jobId,
        targetId: form.targetId,
        capMicros,
        halfOpenTtlSeconds: ttl,
      }).unwrap();
      router.push(`/budgets/${budget.id}`);
    } catch (err) {
      if (isFetchBaseQueryError(err) && err.status === 409) {
        setSubmitError(`A budget already exists for ${form.orgId}/${form.jobId}/${form.targetId}.`);
      } else if (isFetchBaseQueryError(err) && err.data?.message) {
        const msg = err.data.message;
        setSubmitError(Array.isArray(msg) ? msg.join(', ') : msg);
      } else {
        setSubmitError('Could not create budget. Please try again.');
      }
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 max-w-sm">
      {submitError && (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Description>{submitError}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      <TextField isInvalid={!!errors.orgId}>
        <Label>Org ID</Label>
        <Input value={form.orgId} onChange={set('orgId')} />
        <FieldError>{errors.orgId}</FieldError>
      </TextField>

      <TextField isInvalid={!!errors.jobId}>
        <Label>Job ID</Label>
        <Input value={form.jobId} onChange={set('jobId')} />
        <FieldError>{errors.jobId}</FieldError>
      </TextField>

      <TextField isInvalid={!!errors.targetId}>
        <Label>Target ID</Label>
        <Input value={form.targetId} onChange={set('targetId')} />
        <FieldError>{errors.targetId}</FieldError>
      </TextField>

      <TextField isInvalid={!!errors.capUsd}>
        <Label>Cap (USD)</Label>
        <Input type="number" step="0.01" min="0.01" value={form.capUsd} onChange={set('capUsd')} placeholder="10.00" />
        <FieldError>{errors.capUsd}</FieldError>
      </TextField>

      <TextField isInvalid={!!errors.halfOpenTtlSeconds}>
        <Label>Half-open TTL (seconds)</Label>
        <Input type="number" min="10" max="3600" value={form.halfOpenTtlSeconds} onChange={set('halfOpenTtlSeconds')} />
        <FieldError>{errors.halfOpenTtlSeconds}</FieldError>
      </TextField>

      <Button type="submit" isDisabled={isLoading}>
        {isLoading ? 'Creating…' : 'Create Budget'}
      </Button>
    </form>
  );
}
