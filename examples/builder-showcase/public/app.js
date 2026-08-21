const $ = s => document.querySelector(s);

function esc(v){
  return String(v ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;");
}

async function request(url,options={}){
  const response=await fetch(url,{
    headers:{"content-type":"application/json"},
    ...options
  });
  const body=await response.json();
  if(!response.ok)throw new Error(body.error||`HTTP ${response.status}`);
  return body;
}

async function animateProgress(){
  const progress=$("#progress");
  progress.classList.remove("hidden");
  const steps=[...progress.querySelectorAll(".step")];
  for(let i=0;i<steps.length;i++){
    steps.forEach((s,j)=>{
      s.classList.toggle("done",j<i);
      s.classList.toggle("active",j===i);
    });
    await new Promise(r=>setTimeout(r,260));
  }
}

function render(data){
  const result=data.result;
  const {spec,plan,proposal}=result;

  $("#result").classList.remove("hidden");
  $("#appName").textContent=spec.name;
  $("#pkgBadge").textContent=spec.packageName;

  $("#actors").innerHTML=spec.actors.map(x=>`<span>${esc(x.label)}</span>`).join("");
  $("#rules").innerHTML=spec.rules.map(x=>`<div class="rule">${esc(x.description)}</div>`).join("");
  $("#capabilities").innerHTML=plan.capabilities.map(x=>`
    <div class="cap">
      <b>${esc(x.id)}</b>
      <span class="${x.source}">${x.source.toUpperCase()}</span>
    </div>`).join("");

  const workflowId=plan.workflowIds[0]||"—";
  $("#workflowId").textContent=workflowId;

  const targetVersion=plan.workflowVersions?.[workflowId]||"1";
  const runtimeWorkflow=proposal.impact.runtime?.workflows?.find(x=>x.workflowId===workflowId);
  const observed=Object.keys(runtimeWorkflow?.versions||{});
  const currentVersion=observed
    .map(Number)
    .filter(Number.isFinite)
    .sort((a,b)=>b-a)[0];

  $("#currentVersion").textContent=currentVersion?`v${currentVersion}`:"NEW";
  $("#targetVersion").textContent=`v${targetVersion}`;

  $("#surfaceNodes").innerHTML=plan.surfaceKinds.map(x=>`<div class="surface-node">${esc(x)}</div>`).join("");

  $("#releasePkg").textContent=proposal.packageName;
  $("#releaseVersion").textContent=proposal.version;
  $("#artifactCount").textContent=proposal.artifacts.length;
  $("#testCount").textContent=plan.tests.length;
  $("#surfaceCount").textContent=plan.surfaceKinds.length;
  const deployment=proposal.deploymentPlan;
  const deploymentBadge=$("#deploymentBadge");
  deploymentBadge.textContent=deployment?.releaseAllowed===false?"BLOCKED":"RELEASE READY";
  $("#deployTarget").textContent=deployment?.target?`v${deployment.target.workflowVersion}`:"—";
  $("#retainOld").textContent=deployment?.previous?`v${deployment.previous.workflowVersion}`:"none";
  $("#retireState").textContent=deployment?.retireGate?.ready?"READY":"WAIT";
  $("#deploymentSteps").innerHTML=(deployment?.steps||[]).map(x=>`
    <div class="deployment-step"><b>${esc(x.phase.toUpperCase())}</b> · ${esc(x.detail)}</div>
  `).join("");

  const migration=proposal.migrationPlan;
  const migrationBadge=$("#migrationBadge");
  migrationBadge.textContent=migration?.releaseAllowed===false?"BLOCKED":(migration?.selected||"NONE").toUpperCase();
  migrationBadge.classList.toggle("blocked",migration?.releaseAllowed===false);
  const keep=migration?.actions?.find(x=>x.type==="keep-workflow-version");
  const route=migration?.actions?.find(x=>x.type==="route-new-executions");
  $("#migrationOld").textContent=keep?.fromVersion?`v${keep.fromVersion} stays pinned`:"No old version pin";
  $("#migrationNew").textContent=route?.toVersion?`v${route.toVersion}`:"Current";
  $("#migrationActions").innerHTML=(migration?.actions||[]).map(x=>`
    <div class="migration-action"><b>${esc(x.type)}</b> · ${esc(x.detail)}</div>
  `).join("") || `<div class="migration-action">No migration action required.</div>`;

  const contracts=proposal.contractCompatibility;
  const contractBadge=$("#contractBadge");
  contractBadge.textContent=contracts?.compatible===false?"BLOCKED":"COMPATIBLE";
  contractBadge.classList.toggle("blocked",contracts?.compatible===false);
  $("#contractIssueCount").textContent=(contracts?.issues||[]).filter(x=>x.severity==="error").length;
  const payloadChecks=contracts?.runtimePayloadChecks||[];
  $("#payloadSampleCount").textContent=payloadChecks.reduce((n,x)=>n+x.samples,0);
  $("#payloadCompatibleCount").textContent=payloadChecks.filter(x=>x.compatible).reduce((n,x)=>n+x.samples,0);
  $("#contractIssues").innerHTML=(contracts?.issues||[]).slice(0,5).map(x=>`
    <div class="contract-issue ${x.severity}">
      <b>${esc(x.code)}</b> · ${esc(x.message)}
    </div>`).join("") || `<div class="contract-issue">No breaking contract changes detected.</div>`;

  const impact=proposal.impact;
  $("#impactRisk").textContent=impact.activeExecutionRisk.toUpperCase();
  $("#riskLabel").textContent=impact.activeExecutionRisk.toUpperCase();
  $("#activeCount").textContent=impact.runtime?.activeExecutions??0;
  $("#suspendedCount").textContent=impact.runtime?.suspendedExecutions??0;
  $("#observedVersions").textContent=Object.keys(runtimeWorkflow?.versions||{}).map(v=>`v${v}`).join(", ")||"—";
  $("#riskNote").textContent=impact.notes?.[0]||impact.versionRecommendation;

  const changeSet=proposal.changeSet;
  const changeSafety=proposal.changeSafety;

  $("#addedCount").textContent=changeSet?.summary?.added??0;
  $("#modifiedCount").textContent=changeSet?.summary?.modified??0;
  $("#removedCount").textContent=changeSet?.summary?.removed??0;
  $("#affectedCount").textContent=changeSet?.summary?.affectedNodes??0;

  const safetyNode=$("#changeSafety");
  safetyNode.textContent=changeSafety?.safe===false?"BLOCKED":"SAFE";
  safetyNode.classList.toggle("unsafe",changeSafety?.safe===false);

  $("#changeItems").innerHTML=(changeSet?.items||[])
    .filter(x=>x.kind!=="package")
    .slice(0,8)
    .map(x=>`
      <div class="change-item ${x.change}">
        <em>${x.change.toUpperCase()}</em>
        <span>${esc(x.kind)} · ${esc(x.id)}</span>
        <small>${x.before?.version&&x.after?.version?`v${esc(x.before.version)} → v${esc(x.after.version)}`:`${x.affected?.length||0} affected`}</small>
      </div>`)
    .join("");

  $("#files").innerHTML=proposal.artifacts.map(x=>`<div class="file">${esc(x.path)}</div>`).join("");

  const workflow=proposal.artifacts.find(x=>x.path==="src/workflows/leave.ts");
  $("#code").textContent=workflow?.content||"";
}

$("#buildButton").addEventListener("click",async()=>{
  const button=$("#buildButton");
  button.disabled=true;
  button.textContent="Building…";

  try{
    const buildPromise=request("/api/build",{
      method:"POST",
      body:JSON.stringify({
        description:$("#requirement").value,
        companyScope:"acme"
      })
    });

    await animateProgress();
    const data=await buildPromise;
    render(data);
  }catch(error){
    alert(error.message);
  }finally{
    button.disabled=false;
    button.textContent="Build application ↗";
  }
});
