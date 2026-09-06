import { createTaskAction } from "@/lib/actions/tasks";
import { Disclosure, Field } from "./ui";

export function NewTaskForm({ today, defaultUrgency = "medium" }: { today: string; defaultUrgency?: string }) {
  return (
    <Disclosure summary={<span className="btn btn-primary btn-sm">+ New task</span>}>
      <form action={createTaskAction} className="card grid gap-3 p-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Task">
            <input className="field" name="title" required placeholder="Reach out to 3 people in your audience" autoFocus />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Details (optional)">
            <input className="field" name="details" placeholder="What does done look like?" />
          </Field>
        </div>
        <Field label="Due">
          <input className="field" name="dueDate" type="date" defaultValue={today} />
        </Field>
        <Field label="Priority">
          <select className="field" name="urgency" defaultValue={defaultUrgency}>
            <option value="top3">★ Top 3 today (+15)</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </Field>
        <Field label="Area">
          <select className="field" name="category" defaultValue="sales">
            <option value="sales">💬 Sales / outreach</option>
            <option value="content">✍️ Content</option>
            <option value="community">👥 Community</option>
            <option value="system">⚙️ System</option>
            <option value="fulfillment">🤝 Fulfillment</option>
            <option value="admin">🗂️ Admin</option>
          </select>
        </Field>
        <Field label="Repeat every (days)" hint="Leave blank for a one-off. 1 = daily habit.">
          <input className="field" name="repeatEveryDays" type="number" min={1} max={90} placeholder="—" />
        </Field>
        <div className="sm:col-span-2">
          <button className="btn btn-primary" type="submit">
            Add task
          </button>
        </div>
      </form>
    </Disclosure>
  );
}
