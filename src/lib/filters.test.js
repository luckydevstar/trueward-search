import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSoftwareRole, isFullyRemote, isUS, applyRules } from './filters.js';

test('software titles are accepted', () => {
  for (const t of [
    'Senior Software Engineer', 'Full Stack Developer', 'Frontend Engineer (React)', 'Back-End Developer',
    'iOS Engineer', 'SDET II', 'Python Developer', 'Staff Platform Engineer', 'Web Developer', '.NET Developer',
    'Machine Learning Engineer', 'DevOps Engineer', 'Node.js Engineer', 'Product Engineer', 'Founding Engineer',
  ]) assert.equal(isSoftwareRole(t).ok, true, t);
});

test('non-software titles are rejected', () => {
  for (const t of [
    'Sales Engineer', 'Business Development Representative', 'Mechanical Engineer', 'Solutions Engineer',
    'Technical Recruiter - Software Engineering', 'Product Designer', 'Customer Support Engineer', 'Registered Nurse',
    'Real Estate Developer', 'Account Executive', 'Axonius Software Specialist', 'Software Development Manager',
    'Software Sales Representative', 'Software Engineering Intern',
  ]) assert.equal(isSoftwareRole(t).ok, false, t);
});

test('hybrid / on-site / on-site interview are rejected', () => {
  for (const d of [
    'This is a hybrid role based in Austin.',
    'You will work 3 days a week in the office.',
    'Final round is an on-site interview at our HQ.',
    'In-person interviews are required.',
    'Candidates must be able to commute to our Denver office.',
    'Hybrid: Tuesday–Thursday.',
    'This position is not remote.',
    'This role is categorized as hybrid. You are expected to report to the office.',
    'Location: Omaha, NE – Hybrid',
    'Hybrid (3 days in office)',
    'Possibility of a hybrid work arrangement.',
    'Interviews will be conducted via virtual meetings and/or onsite.',
    'We may invite finalists to our San Francisco office for onsite interviews.',
    'Occasional in-person attendance is required for all employees.',
  ]) assert.equal(isFullyRemote({ remote: true, title: 'Software Engineer', description: d }).ok, false, d);
});

test('remote jobs with harmless wording are accepted', () => {
  for (const d of [
    'Fully remote. Experience with hybrid cloud environments is a plus.',
    'Build hybrid apps with Ionic.',
    'We are remote-first; no on-site interviews.',
    'Remote within the United States.',
    'Remote, hybrid, or in-person is OK. HQ is in Palo Alto.',
    'Fully remote or hybrid from several hubs (SF, Seattle).',
    'Whether you’re remote or office-based, you’ll collaborate with great people.',
    'If you live near an office hub, you are welcome to work in a hybrid capacity.',
    'Experience building RAG pipelines with hybrid retrieval and reranking. Remote.',
    'Understanding of hybrid connectivity (VPNs, Direct Connect). Remote US.',
    'Background designing solutions across hybrid on-prem/cloud environments.',
    'Prior work in product engineering, full-stack engineering, or hybrid roles.',
    'Location(s): US (remote), Boston (hybrid), or New York (hybrid).',
    'This is a remote role, with the exception of onboarding and optional in-office events.',
    'Read https://eng.example.com/Building-a-Service-Mesh-in-a-Hybrid-Environment for context. Remote.',
  ]) assert.equal(isFullyRemote({ remote: true, title: 'Software Engineer', description: d }).ok, true, d);
});

test('remote unknown requires the word remote', () => {
  assert.equal(isFullyRemote({ title: 'Software Engineer', description: 'Join our team in Chicago.' }).ok, false);
  assert.equal(isFullyRemote({ title: 'Software Engineer', description: 'This role is 100% remote.' }).ok, true);
});

test('US location detection', () => {
  for (const loc of ['United States', 'USA', 'Remote - US', 'Austin, TX', 'New York', 'US, Canada', 'Worldwide', 'Americas'])
    assert.equal(isUS({ location: loc }).ok, true, loc);
  for (const loc of ['Canada', 'United Kingdom', 'Europe', 'India', 'LATAM', 'Berlin, Germany'])
    assert.equal(isUS({ location: loc }).ok, false, loc);
});

test('applyRules combines everything', () => {
  assert.equal(applyRules({ title: 'Software Engineer', location: 'United States', remote: true, description: 'Remote role.' }).ok, true);
  assert.equal(applyRules({ title: 'Software Engineer', location: 'United States', remote: false }).ok, false);
});
