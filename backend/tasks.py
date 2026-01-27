import threading

tasks = {}

def run_background_task(task_id, target, *args):
    def wrapper():
        try:
            tasks[task_id]["status"] = "processing"
            result = target(*args)
            tasks[task_id]["result"] = result
            tasks[task_id]["status"] = "completed"
        except Exception as e:
            tasks[task_id]["status"] = "error"
            tasks[task_id]["error"] = str(e)

    thread = threading.Thread(target=wrapper)
    thread.start()
