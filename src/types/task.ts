export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'done' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignee_id: string | null;
  created_by_id: string;
  due_date: Date | null;
  created_at: Date;
  updated_at: Date;
  comments?: Comment[];
  labels?: Label[];
}

export interface Comment {
  id: string;
  task_id: string;
  author_id: string;
  content: string;
  created_at: Date;
  updated_at: Date;
}

export interface Label {
  id: string;
  workspace_id: string;
  name: string;
  colour: string;
  created_at: Date;
}

export interface CreateTaskInput {
  title: string;
  projectId: string;
  createdById: string;
  description?: string;
  priority?: Task['priority'];
  assigneeId?: string | null;
}
