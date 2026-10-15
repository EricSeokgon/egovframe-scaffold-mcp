// test/ci-run-live.mjs 전용 — 컨트롤러 시작 때 생성 Jenkinsfile 을 실행할 Pipeline 작업을 만든다.
// 저장소는 컨테이너에 읽기 전용으로 붙인 /repo(file://, GitSCM.ALLOW_LOCAL_CHECKOUT=true), Jenkinsfile 은 SCM 에서 읽는다(실제 운영과 같은 경로).
import jenkins.model.Jenkins
import org.jenkinsci.plugins.workflow.job.WorkflowJob
import org.jenkinsci.plugins.workflow.cps.CpsScmFlowDefinition
import hudson.plugins.git.BranchSpec
import hudson.plugins.git.GitSCM

def jenkins = Jenkins.get()
if (jenkins.getItem("egov-ci") == null) {
  def job = jenkins.createProject(WorkflowJob, "egov-ci")
  def scm = new GitSCM(GitSCM.createRepoList("file:///repo", null), [new BranchSpec("*/main")], null, null, [])
  def flow = new CpsScmFlowDefinition(scm, "Jenkinsfile")
  flow.setLightweight(false)
  job.setDefinition(flow)
  job.save()
}
